import type { GeocodedPoint, OptimizedStop, SortMode } from '../types';
import type { RouteMatrix } from '../services/routing';

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
  /** 実ルート検索のための距離・時間行列（任意） */
  routeMatrix?: RouteMatrix;
}

/** 
 * 最適化のコスト（基準値）を取得する。
 * routeMatrix があれば「移動時間（秒）」をコストとし、
 * なければ「直線距離（km）」をコストとする。
 */
function getCost(
  i: number,
  j: number,
  points: GeocodedPoint[],
  routeMatrix?: RouteMatrix
): number {
  if (routeMatrix) {
    // durations 行列から時間を取得
    return routeMatrix.durations[i][j];
  }
  // フォールバック: 直線距離
  return haversineDistance(points[i].lat, points[i].lng, points[j].lat, points[j].lng);
}

/**
 * Nearest Neighbor法で初期ルートを生成する。
 * points[0]を出発地として固定し、最も近い未訪問地点を貪欲に選ぶ。
 * fixedEnd=true の場合、最後の地点（帰着地）も固定する。
 */
function nearestNeighbor(
  points: GeocodedPoint[],
  fixedEnd: boolean,
  routeMatrix?: RouteMatrix
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
      const dist = getCost(current, i, points, routeMatrix);
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
  fixedEnd: boolean,
  routeMatrix?: RouteMatrix
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
        const d1Before = getCost(improved[i - 1], improved[i], points, routeMatrix);

        // エッジ2: (j) → (j+1) または巡回路の復路エッジ
        let d2Before: number;
        if (j + 1 < n) {
          d2Before = getCost(improved[j], improved[j + 1], points, routeMatrix);
        } else if (roundTrip) {
          // 巡回路: 最後→最初への復路エッジ
          d2Before = getCost(improved[j], improved[0], points, routeMatrix);
        } else {
          d2Before = 0;
        }

        // 反転後: (i-1) → (j) と (i) → (j+1)
        const d1After = getCost(improved[i - 1], improved[j], points, routeMatrix);

        let d2After: number;
        if (j + 1 < n) {
          d2After = getCost(improved[i], improved[j + 1], points, routeMatrix);
        } else if (roundTrip) {
          d2After = getCost(improved[i], improved[0], points, routeMatrix);
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
  const { roundTrip = false, fixedEnd = false, sortMode = 'optimized', routeMatrix } = options;

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
    const initialRoute = nearestNeighbor(points, fixedEnd, routeMatrix);
    finalRoute = twoOpt(initialRoute, points, roundTrip, fixedEnd, routeMatrix);
  } else {
    // 近い順 / 遠い順: 出発地からのコスト（距離または時間）でソート

    // 中間地点のインデックスを抽出（出発地と帰着地を除く）
    const middleIndices: number[] = [];
    for (let i = 1; i < (fixedEnd ? points.length - 1 : points.length); i++) {
      middleIndices.push(i);
    }

    // 出発地からの距離でソート
    middleIndices.sort((a, b) => {
      const costA = getCost(0, a, points, routeMatrix);
      const costB = getCost(0, b, points, routeMatrix);
      return sortMode === 'nearest' ? costA - costB : costB - costA;
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
    let durationFromPrev: number | undefined = undefined;

    if (order > 0) {
      const prevIndex = finalRoute[order - 1];
      if (routeMatrix) {
        // 実走ルートがある場合は、APIが返した距離（m -> km）と時間（秒）を使用
        distanceFromPrev = routeMatrix.distances[prevIndex][pointIndex] / 1000;
        durationFromPrev = routeMatrix.durations[prevIndex][pointIndex];
      } else {
        // フォールバック: 直線距離
        distanceFromPrev = haversineDistance(
          points[prevIndex].lat,
          points[prevIndex].lng,
          points[pointIndex].lat,
          points[pointIndex].lng
        );
      }
    }

    return {
      order,
      point: points[pointIndex],
      distanceFromPrev,
      durationFromPrev,
    };
  });

  return stops;
}
