import type { GeocodedPoint } from '../types';

export interface RouteMatrix {
  /** 移動時間（秒）の行列。durations[i][j] は 地点iから地点jへの所要時間 */
  durations: number[][];
  /** 走行距離（メートル）の行列。distances[i][j] は 地点iから地点jへの走行距離 */
  distances: number[][];
}

/** OSRM Public API エンドポイント */
const OSRM_ENDPOINT = 'https://router.project-osrm.org/table/v1/driving/';

/**
 * 地点リストからOSRM Table APIを呼び出し、距離・時間のコスト行列を取得する。
 * 最大100地点まで。
 */
export async function fetchRouteMatrix(
  points: GeocodedPoint[]
): Promise<RouteMatrix | null> {
  // 1地点以下の場合は行列を取得する意味がない
  if (points.length <= 1) return null;
  // OSRM Public APIの制限への配慮（多すぎる場合はフォールバックさせるためnullを返す）
  if (points.length > 100) {
    console.warn('100地点を超えているため、OSRMの実ルート検索をスキップし直線距離で計算します。');
    return null;
  }

  try {
    // 座標を {lng},{lat} の形式で結合
    const coordinates = points.map((p) => `${p.lng},${p.lat}`).join(';');
    
    // annotations=duration,distance で時間と距離の両方を要求
    const url = `${OSRM_ENDPOINT}${coordinates}?annotations=duration,distance`;

    const response = await fetch(url);
    
    if (!response.ok) {
      console.warn(`OSRM API error: ${response.status} ${response.statusText}`);
      return null;
    }

    const data = await response.json();

    if (data.code !== 'Ok' || !data.durations || !data.distances) {
      console.warn('OSRM API returned invalid format or non-Ok status', data);
      return null;
    }

    return {
      durations: data.durations,
      distances: data.distances,
    };
  } catch (err) {
    console.error('Failed to fetch route matrix from OSRM', err);
    return null; // エラー時はnullを返し、直線距離（フォールバック）を利用させる
  }
}
