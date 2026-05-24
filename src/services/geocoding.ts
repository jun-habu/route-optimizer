import type {
  ParsedEntry,
  GeocodingProgress,
  GeocodingResult,
  GeocodedPoint,
  GeocodingFailedPoint,
} from '../types';

/**
 * 国土地理院 住所検索API エンドポイント
 * - CORS対応済み
 * - User-Agentヘッダー不要
 * - 日本の住所に特化した高精度な検索
 * - 完全無料
 */
const GSI_ENDPOINT = 'https://msearch.gsi.go.jp/address-search/AddressSearch';

/** リクエスト間の最低ディレイ（ms）- サーバー負荷軽減のため */
const REQUEST_DELAY_MS = 200;

/** リトライ最大回数 */
const MAX_RETRIES = 2;

/** リトライ間隔（ms） */
const RETRY_DELAY_MS = 1500;

/**
 * 指定ミリ秒だけ待機する。
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 国土地理院APIのレスポンス型（GeoJSON Feature）。
 */
interface GSIFeature {
  geometry: {
    coordinates: [number, number]; // [lng, lat]
    type: string;
  };
  type: string;
  properties: {
    addressCode: string;
    title: string;
  };
}

/**
 * Wikipedia APIを使用してランドマーク（駅、空港など）の座標を検索する。
 */
async function searchWikipediaLandmark(
  query: string
): Promise<{ lat: number; lng: number; title: string } | null> {
  try {
    const params = new URLSearchParams({
      action: 'query',
      generator: 'search',
      gsrsearch: query,
      gsrlimit: '1',
      prop: 'coordinates',
      format: 'json',
      origin: '*', // CORS対応
    });
    const response = await fetch(`https://ja.wikipedia.org/w/api.php?${params.toString()}`);
    if (!response.ok) return null;
    const data = await response.json();
    if (!data.query || !data.query.pages) return null;

    const pages = Object.values(data.query.pages) as any[];
    if (pages.length === 0) return null;

    const page = pages[0];
    if (page.coordinates && page.coordinates.length > 0) {
      return {
        lat: page.coordinates[0].lat,
        lng: page.coordinates[0].lon, // Wikipedia APIは 'lon'
        title: page.title,
      };
    }
  } catch (err) {
    // エラー時はフォールバックするため無視
  }
  return null;
}

/**
 * 1件の住所をジオコーディングする（リトライ付き）。
 * 国土地理院の住所検索APIを使用。駅などはWikipedia APIを優先。
 */
async function geocodeSingleAddress(
  address: string
): Promise<{ lat: number; lng: number; title: string } | { error: string }> {
  // 1. ランドマークの判定（駅、空港など、または都道府県市区町村を含まない短い単語）
  const isLandmark =
    /(駅|空港|港|インターチェンジ|IC|SA|PA|タワー|城|公園|ランド|パーク|館|寺|神社|宮)$/.test(address) ||
    (!/[都道府県市区町村]/.test(address) && address.length < 15);

  if (isLandmark) {
    const wikiResult = await searchWikipediaLandmark(address);
    if (wikiResult) {
      return wikiResult; // Wikipediaで座標が見つかればそれを返す
    }
  }

  // 2. 国土地理院APIでの住所検索
  let lastError = '';

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await delay(RETRY_DELAY_MS);
    }

    try {
      const params = new URLSearchParams({
        q: address,
      });

      const response = await fetch(`${GSI_ENDPOINT}?${params.toString()}`);

      if (!response.ok) {
        lastError = `HTTPエラー: ${response.status} ${response.statusText}`;
        continue;
      }

      const data: GSIFeature[] = await response.json();

      if (data.length === 0) {
        // 空配列の場合はリトライしない（住所が見つからない）
        return { error: '住所が見つかりませんでした' };
      }

      // 国土地理院APIはcoordinatesが [lng, lat] の順
      const [lng, lat] = data[0].geometry.coordinates;
      const title = data[0].properties.title;

      return { lat, lng, title };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  return { error: lastError };
}

/**
 * 複数の住所エントリを順次ジオコーディングする。
 * 国土地理院APIへの負荷軽減のため、リクエスト間にディレイを挟む。
 */
export async function geocodeAddresses(
  entries: ParsedEntry[],
  onProgress?: (progress: GeocodingProgress) => void
): Promise<GeocodingResult[]> {
  const results: GeocodingResult[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];

    // 進捗通知
    if (onProgress) {
      onProgress({
        current: i + 1,
        total: entries.length,
        currentAddress: entry.address,
      });
    }

    // サーバー負荷軽減: 2件目以降はディレイを挟む
    if (i > 0) {
      await delay(REQUEST_DELAY_MS);
    }

    const result = await geocodeSingleAddress(entry.address);

    if ('error' in result) {
      const failedPoint: GeocodingFailedPoint = {
        originalLine: entry.originalLine,
        address: entry.address,
        label: entry.label,
        geocoded: false,
        error: result.error,
      };
      results.push(failedPoint);
    } else {
      const geocodedPoint: GeocodedPoint = {
        originalLine: entry.originalLine,
        // APIが実際にマッチした住所（title）で上書きすることで、
        // ユーザーが意図しない都道府県にマッチした際に気づけるようにする
        address: result.title || entry.address,
        label: entry.label,
        lat: result.lat,
        lng: result.lng,
        geocoded: true,
      };
      results.push(geocodedPoint);
    }
  }

  return results;
}
