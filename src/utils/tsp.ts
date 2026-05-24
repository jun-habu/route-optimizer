import type { GeocodedPoint, OptimizedStop, SortMode } from '../types';

/** 地球の平均半径（km） */
const EARTH_RADIUS_KM = 6371;

/** 角度をラジアンに変換する */
function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Haversine公式を使って2点間の距離（km）を計算する。
 */
export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_KM * c;
}

/** ルート最適化のオプション */
export interface RouteOptions {
  /** true: 出発地に戻る巡回路（return edgeを含めて最適化） */
  roundTrip?: boolean;
  /** true: 配列の最後の要素を帰着地として固定（入れ替え対象外） */
  fixedEnd?: boolean;
  /** ルートの並び順モード（デフォルト: 'optimized'） */
  sortMode?: SortMode;
}

/**
 * Nearest Neighbor法で初期ルートを生成する。
 * points[0]を出発地として固定し、最も近い未訪問地点を貪欲に選ぶ。
 * fixedEnd=true の場合、最後の地点（帰着地）も固定する。
 */
function nearestNeighbor(
  points: GeocodedPoint[],
  fixedEnd: boolean
): number[] {
  const n = points.length;
  const visited = new Set<number>([0]);
  const route: number[] = [0];

  // fixedEndの場合、帰着地（最後の要素）を予約しておく
  if (fixedEnd && n > 1) {
    visited.add(n - 1);
  }

  const middleCount = fixedEnd ? n - 2 : n - 1;

  for (let step = 0; step < middleCount; step++) {
    const current = route[route.length - 1];
    let nearestIndex = -1;
    let nearestDist = Infinity;

    for (let i = 0; i < n; i++) {
      if (visited.has(i)) continue;
      const dist = haversineDistance(
        points[current].lat,
        points[current].lng,
        points[i].lat,
        points[i].lng
      );
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestIndex = i;
      }
    }

    if (nearestIndex !== -1) {
      route.push(nearestIndex);
      visited.add(nearestIndex);
    }
  }

  // 帰着地を最後に追加
  if (fixedEnd && n > 1) {
    route.push(n - 1);
  }

  return route;
}

/**
 * 2-opt法でルートを改善する。
 * 出発地（index 0）は固定し、入れ替え対象にしない。
 * fixedEnd=true の場合、帰着地（最後の要素）も固定。
 * roundTrip=true の場合、最後→最初の復路エッジも距離計算に含める。
 */
function twoOpt(
  route: number[],
  points: GeocodedPoint[],
  roundTrip: boolean,
  fixedEnd: boolean
): number[] {
  const improved = [...route];
  const n = improved.length;
  let hasImproved = true;

  // 入れ替え対象の末端: fixedEndなら最後の1つ手前まで
  const jMax = fixedEnd ? n - 2 : n - 1;

  while (hasImproved) {
    hasImproved = false;

    // i=1から開始（出発地を固定）
    for (let i = 1; i < jMax; i++) {
      for (let j = i + 1; j <= jMax; j++) {
        // エッジ1: (i-1) → (i)
        const d1Before = haversineDistance(
          points[improved[i - 1]].lat,
          points[improved[i - 1]].lng,
          points[improved[i]].lat,
          points[improved[i]].lng
        );

        // エッジ2: (j) → (j+1) または巡回路の復路エッジ
        let d2Before: number;
        if (j + 1 < n) {
          d2Before = haversineDistance(
            points[improved[j]].lat,
            points[improved[j]].lng,
            points[improved[j + 1]].lat,
            points[improved[j + 1]].lng
          );
        } else if (roundTrip) {
          // 巡回路: 最後→最初への復路エッジ
          d2Before = haversineDistance(
            points[improved[j]].lat,
            points[improved[j]].lng,
            points[improved[0]].lat,
            points[improved[0]].lng
          );
        } else {
          d2Before = 0;
        }

        // 反転後: (i-1) → (j) と (i) → (j+1)
        const d1After = haversineDistance(
          points[improved[i - 1]].lat,
          points[improved[i - 1]].lng,
          points[improved[j]].lat,
          points[improved[j]].lng
        );

        let d2After: number;
        if (j + 1 < n) {
          d2After = haversineDistance(
            points[improved[i]].lat,
            points[improved[i]].lng,
            points[improved[j + 1]].lat,
            points[improved[j + 1]].lng
          );
        } else if (roundTrip) {
          d2After = haversineDistance(
            points[improved[i]].lat,
            points[improved[i]].lng,
            points[improved[0]].lat,
            points[improved[0]].lng
          );
        } else {
          d2After = 0;
        }

        if (d1After + d2After < d1Before + d2Before) {
          // i〜j間のセグメントを反転
          const reversed = improved.slice(i, j + 1).reverse();
          for (let k = 0; k < reversed.length; k++) {
            improved[i + k] = reversed[k];
          }
          hasImproved = true;
        }
      }
    }
  }

  return improved;
}

/**
 * GeocodedPointの配列を受け取り、TSPを解いて最適化されたルートを返す。
 * points[0]を出発地として固定する。
 *
 * options.roundTrip = true: 出発地に戻る巡回路として最適化
 * options.fixedEnd = true: points[末尾]を帰着地として固定し、中間地点のみ最適化
 */
export function optimizeRoute(
  points: GeocodedPoint[],
  options: RouteOptions = {}
): OptimizedStop[] {
  const { roundTrip = false, fixedEnd = false, sortMode = 'optimized' } = options;

  if (points.length === 0) return [];

  if (points.length === 1) {
    return [
      {
        order: 0,
        point: points[0],
        distanceFromPrev: 0,
      },
    ];
  }

  let finalRoute: number[];

  if (sortMode === 'optimized') {
    // TSP: Nearest Neighbor法 + 2-opt法
    const initialRoute = nearestNeighbor(points, fixedEnd);
    finalRoute = twoOpt(initialRoute, points, roundTrip, fixedEnd);
  } else {
    // 近い順 / 遠い順: 出発地からのHaversine距離でソート
    const departure = points[0];

    // 中間地点のインデックスを抽出（出発地と帰着地を除く）
    const middleIndices: number[] = [];
    for (let i = 1; i < (fixedEnd ? points.length - 1 : points.length); i++) {
      middleIndices.push(i);
    }

    // 出発地からの距離でソート
    middleIndices.sort((a, b) => {
      const distA = haversineDistance(
        departure.lat, departure.lng,
        points[a].lat, points[a].lng
      );
      const distB = haversineDistance(
        departure.lat, departure.lng,
        points[b].lat, points[b].lng
      );
      return sortMode === 'nearest' ? distA - distB : distB - distA;
    });

    // ルートを組み立て: [出発地, ...ソート済み中間地点, (帰着地)]
    finalRoute = [0, ...middleIndices];
    if (fixedEnd) {
      finalRoute.push(points.length - 1);
    }
  }

  // OptimizedStop[]に変換
  const stops: OptimizedStop[] = finalRoute.map((pointIndex, order) => {
    let distanceFromPrev = 0;
    if (order > 0) {
      const prevIndex = finalRoute[order - 1];
      distanceFromPrev = haversineDistance(
        points[prevIndex].lat,
        points[prevIndex].lng,
        points[pointIndex].lat,
        points[pointIndex].lng
      );
    }

    return {
      order,
      point: points[pointIndex],
      distanceFromPrev,
    };
  });

  return stops;
}
