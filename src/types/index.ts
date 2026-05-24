/** 入力行から解析された1件の住所エントリ */
export interface ParsedEntry {
  /** 元のテキスト行（企業名等含む） */
  originalLine: string;
  /** 抽出された住所文字列 */
  address: string;
  /** 行に含まれていた企業名・施設名（住所部分を除いた残り） */
  label: string;
}

/** ジオコーディング結果を含む地点情報 */
export interface GeocodedPoint {
  /** 元のテキスト行 */
  originalLine: string;
  /** 抽出された住所 */
  address: string;
  /** ラベル（企業名等） */
  label: string;
  /** 緯度 */
  lat: number;
  /** 経度 */
  lng: number;
  /** ジオコーディング成功フラグ */
  geocoded: true;
}

/** ジオコーディング失敗エントリ */
export interface GeocodingFailedPoint {
  originalLine: string;
  address: string;
  label: string;
  geocoded: false;
  error: string;
}

/** ジオコーディング結果のユニオン型 */
export type GeocodingResult = GeocodedPoint | GeocodingFailedPoint;

/** 最適化済みルート内の1地点 */
export interface OptimizedStop {
  /** 最適化後の順番（0始まり、0が出発地） */
  order: number;
  /** 地点情報 */
  point: GeocodedPoint;
  /** 前の地点からの距離（km）。出発地は 0 */
  distanceFromPrev: number;
}

/** アプリケーション全体の処理状態 */
export type AppStatus =
  | 'idle'
  | 'parsing'
  | 'geocoding'
  | 'optimizing'
  | 'done'
  | 'error';

/** 帰着地モード */
export type ArrivalMode = 'same' | 'different';

/** ルート並び順モード */
export type SortMode = 'optimized' | 'nearest' | 'farthest';

/** ジオコーディング進捗情報 */
export interface GeocodingProgress {
  current: number;
  total: number;
  currentAddress: string;
}
