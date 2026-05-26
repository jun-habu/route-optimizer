import { useState, useCallback, useRef } from 'react';
import {
  Zap,
  MapPin,
  Navigation,
  AlertTriangle,
  RotateCcw,
  Copy,
  Check,
  ArrowRight,
  Loader2,
  ExternalLink,
  Flag,
  Home,
} from 'lucide-react';
import type {
  ParsedEntry,
  GeocodedPoint,
  GeocodingResult,
  OptimizedStop,
  AppStatus,
  GeocodingProgress,
  ArrivalMode,
  SortMode,
} from '../types';
import { parseInputText } from '../utils/parser';
import { optimizeRoute, haversineDistance } from '../utils/tsp';
import { geocodeAddresses } from '../services/geocoding';
import { fetchRouteMatrix } from '../services/routing';

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}秒`;
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m}分`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}時間${rm > 0 ? ` ${rm}分` : ''}`;
}

const PLACEHOLDER = `株式会社A 広島県広島市中区基町10-52
タワーB 広島市中区大手町1-2-1
（株）CC 広島市南区松原町2-37`;

export function Dashboard() {
  const [departureText, setDepartureText] = useState('');
  const [arrivalMode, setArrivalMode] = useState<ArrivalMode>('same');
  const [arrivalText, setArrivalText] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('optimized');
  const [inputText, setInputText] = useState('');
  const [status, setStatus] = useState<AppStatus>('idle');
  const [progress, setProgress] = useState<GeocodingProgress | null>(null);
  const [optimizedStops, setOptimizedStops] = useState<OptimizedStop[]>([]);
  const [failedEntries, setFailedEntries] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState('');
  const [copied, setCopied] = useState(false);
  const [returnDistance, setReturnDistance] = useState(0);
  const [returnDuration, setReturnDuration] = useState(0);
  const [totalDuration, setTotalDuration] = useState(0);
  const [routeMatrixUsed, setRouteMatrixUsed] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);

  const totalDistance =
    optimizedStops.reduce((sum, stop) => sum + stop.distanceFromPrev, 0) +
    (arrivalMode === 'same' ? returnDistance : 0);

  const handleOptimize = useCallback(async () => {
    if (!departureText.trim()) {
      setErrorMessage('出発地を入力してください。');
      setStatus('error');
      return;
    }
    if (arrivalMode === 'different' && !arrivalText.trim()) {
      setErrorMessage('帰着地を入力してください。');
      setStatus('error');
      return;
    }

    const text = inputText.trim();
    if (!text) {
      setErrorMessage('訪問先を入力してください。');
      setStatus('error');
      return;
    }

    setStatus('parsing');
    setOptimizedStops([]);
    setFailedEntries([]);
    setErrorMessage('');
    setReturnDistance(0);
    setReturnDuration(0);
    setTotalDuration(0);
    setRouteMatrixUsed(false);

    try {
      // Step 1: Parse waypoints
      const parsed: ParsedEntry[] = parseInputText(text);
      if (parsed.length < 1) {
        setErrorMessage(
          '有効な住所が見つかりませんでした。住所を含む行を入力してください。'
        );
        setStatus('error');
        return;
      }

      // Step 2: Build geocoding entries
      // [出発地, ...訪問先, (帰着地)]
      const geocodeEntries: ParsedEntry[] = [
        {
          originalLine: departureText.trim(),
          address: departureText.trim(),
          label: '',
        },
        ...parsed,
      ];

      if (arrivalMode === 'different') {
        geocodeEntries.push({
          originalLine: arrivalText.trim(),
          address: arrivalText.trim(),
          label: '',
        });
      }

      // Step 3: Geocode
      setStatus('geocoding');
      const results: GeocodingResult[] = await geocodeAddresses(
        geocodeEntries,
        (p) => setProgress(p)
      );

      // Check departure
      const depResult = results[0];
      if (!depResult.geocoded) {
        setErrorMessage(
          `出発地「${departureText.trim()}」の位置を特定できませんでした。より詳しい住所や地名を試してください。`
        );
        setStatus('error');
        return;
      }

      // Separate waypoint results
      const wpResults =
        arrivalMode === 'different'
          ? results.slice(1, -1)
          : results.slice(1);

      const succeeded: GeocodedPoint[] = wpResults.filter(
        (r): r is GeocodedPoint => r.geocoded
      );
      const failed = wpResults
        .filter((r) => !r.geocoded)
        .map((r) => `${r.label ? r.label + ' ' : ''}${r.address}`);

      setFailedEntries(failed);

      if (succeeded.length < 1) {
        setErrorMessage(
          'ジオコーディングに成功した訪問先がありません。住所の表記を確認してください。'
        );
        setStatus('error');
        return;
      }

      // Check arrival if different
      let arrivalPoint: GeocodedPoint | null = null;
      if (arrivalMode === 'different') {
        const arrResult = results[results.length - 1];
        if (!arrResult.geocoded) {
          setErrorMessage(
            `帰着地「${arrivalText.trim()}」の位置を特定できませんでした。より詳しい住所や地名を試してください。`
          );
          setStatus('error');
          return;
        }
        arrivalPoint = arrResult as GeocodedPoint;
      }

      // Step 4: Build points for TSP
      const tspPoints: GeocodedPoint[] = [
        depResult as GeocodedPoint,
        ...succeeded,
      ];
      if (arrivalPoint) {
        tspPoints.push(arrivalPoint);
      }

      // Step 5: Optimize
      setStatus('optimizing');
      
      // OSRMで実ルート検索
      const routeMatrix = await fetchRouteMatrix(tspPoints);
      setRouteMatrixUsed(!!routeMatrix);

      await new Promise((r) => setTimeout(r, 100)); // 少し待つ（UI更新用）

      const stops = optimizeRoute(tspPoints, {
        roundTrip: arrivalMode === 'same',
        fixedEnd: arrivalMode === 'different',
        sortMode,
        routeMatrix: routeMatrix || undefined,
      });

      // Calculate return distance for round trip
      let retDist = 0;
      let retDur = 0;
      if (arrivalMode === 'same' && stops.length > 1) {
        const lastStop = stops[stops.length - 1];
        const firstStop = stops[0];
        
        if (routeMatrix) {
          // tspPoints上でのインデックスを取得して行列から引く
          const lastIndex = tspPoints.indexOf(lastStop.point);
          const firstIndex = 0;
          retDist = routeMatrix.distances[lastIndex][firstIndex] / 1000;
          retDur = routeMatrix.durations[lastIndex][firstIndex];
        } else {
          retDist = haversineDistance(
            lastStop.point.lat,
            lastStop.point.lng,
            firstStop.point.lat,
            firstStop.point.lng
          );
        }
      }
      setReturnDistance(retDist);
      setReturnDuration(retDur);

      // 合計時間の計算
      const totalDur = stops.reduce((sum, stop) => sum + (stop.durationFromPrev || 0), 0) + (arrivalMode === 'same' ? retDur : 0);
      setTotalDuration(totalDur);

      setOptimizedStops(stops);
      setStatus('done');

      // 結果エリアへスクロール
      setTimeout(() => {
        resultRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });
      }, 100);
    } catch (err) {
      console.error(err);
      setErrorMessage(
        err instanceof Error
          ? err.message
          : '予期しないエラーが発生しました。'
      );
      setStatus('error');
    }
  }, [inputText, departureText, arrivalText, arrivalMode, sortMode]);

  const handleReset = useCallback(() => {
    setInputText('');
    setDepartureText('');
    setArrivalText('');
    setStatus('idle');
    setOptimizedStops([]);
    setFailedEntries([]);
    setErrorMessage('');
    setProgress(null);
    setReturnDistance(0);
    setReturnDuration(0);
    setTotalDuration(0);
    setRouteMatrixUsed(false);
  }, []);

  const generateGoogleMapsUrl = useCallback((): string => {
    if (optimizedStops.length === 0) return '';
    const addresses = optimizedStops.map((stop) =>
      encodeURIComponent(stop.point.address)
    );
    // 巡回路の場合、出発地を末尾にも追加
    if (arrivalMode === 'same') {
      addresses.push(encodeURIComponent(optimizedStops[0].point.address));
    }
    return `https://www.google.com/maps/dir/${addresses.join('/')}`;
  }, [optimizedStops, arrivalMode]);

  const openGoogleMaps = useCallback(() => {
    const url = generateGoogleMapsUrl();
    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }, [generateGoogleMapsUrl]);

  const handleCopyRoute = useCallback(async () => {
    if (optimizedStops.length === 0) return;
    const lines = optimizedStops.map(
      (stop, i) =>
        `${i + 1}. ${stop.point.label ? stop.point.label + ' ' : ''}${stop.point.address}`
    );
    if (arrivalMode === 'same') {
      lines.push(
        `${optimizedStops.length + 1}. （出発地に戻る）${optimizedStops[0].point.address}`
      );
    }
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  }, [optimizedStops, arrivalMode]);

  const isProcessing =
    status === 'parsing' || status === 'geocoding' || status === 'optimizing';

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-6">
      {/* ===== Input Area ===== */}
      <section className="glass-card p-5">
        {/* --- Departure --- */}
        <div className="mb-4">
          <div className="mb-2 flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-success-500/15 text-success-400">
              <Flag className="h-3.5 w-3.5" />
            </div>
            <label
              htmlFor="departure-input"
              className="text-sm font-bold text-text-primary"
            >
              出発地
            </label>
          </div>
          <input
            id="departure-input"
            type="text"
            className="textarea-glass w-full px-4 py-2.5 text-sm"
            placeholder="名称、または住所を入力"
            value={departureText}
            onChange={(e) => setDepartureText(e.target.value)}
            disabled={isProcessing}
            spellCheck={false}
          />
        </div>

        {/* --- Arrival --- */}
        <div className="mb-4">
          <div className="mb-2 flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-accent-500/15 text-accent-400">
              <Home className="h-3.5 w-3.5" />
            </div>
            <span className="text-sm font-bold text-text-primary">帰着地</span>
          </div>

          {/* Segmented control */}
          <div className="mb-2.5 flex rounded-xl bg-dark-900/70 p-1">
            <button
              id="arrival-same-button"
              type="button"
              className={`flex-1 rounded-lg px-3 py-2 text-xs font-medium transition-all ${
                arrivalMode === 'same'
                  ? 'bg-accent-500/20 text-accent-300 shadow-sm'
                  : 'text-text-muted hover:text-text-secondary'
              }`}
              onClick={() => setArrivalMode('same')}
              disabled={isProcessing}
            >
              出発地に戻る
            </button>
            <button
              id="arrival-different-button"
              type="button"
              className={`flex-1 rounded-lg px-3 py-2 text-xs font-medium transition-all ${
                arrivalMode === 'different'
                  ? 'bg-accent-500/20 text-accent-300 shadow-sm'
                  : 'text-text-muted hover:text-text-secondary'
              }`}
              onClick={() => setArrivalMode('different')}
              disabled={isProcessing}
            >
              別の場所に帰着
            </button>
          </div>

          {arrivalMode === 'different' && (
            <input
              id="arrival-input"
              type="text"
              className="textarea-glass w-full px-4 py-2.5 text-sm animate-fade-in-up"
              placeholder="名称、または住所を入力"
              value={arrivalText}
              onChange={(e) => setArrivalText(e.target.value)}
              disabled={isProcessing}
              spellCheck={false}
            />
          )}
        </div>

        {/* --- Divider --- */}
        <div className="my-4 border-t border-dark-500/40" />

        {/* --- Waypoints --- */}
        <div className="mb-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-accent-500/15 text-accent-400">
                <MapPin className="h-3.5 w-3.5" />
              </div>
              <label
                htmlFor="address-input"
                className="text-sm font-bold text-text-primary"
              >
                訪問先
              </label>
              <span className="text-[0.65rem] text-text-muted">
                企業名＋住所をまとめてコピペ
              </span>
            </div>
            
            <div className="flex rounded-lg bg-dark-900/70 p-1">
              <button
                type="button"
                className={`rounded-md px-2.5 py-1.5 text-[0.65rem] font-medium transition-all ${
                  sortMode === 'optimized'
                    ? 'bg-accent-500/20 text-accent-300 shadow-sm'
                    : 'text-text-muted hover:text-text-secondary'
                }`}
                onClick={() => setSortMode('optimized')}
                disabled={isProcessing}
              >
                最短ルート
              </button>
              <button
                type="button"
                className={`rounded-md px-2.5 py-1.5 text-[0.65rem] font-medium transition-all ${
                  sortMode === 'nearest'
                    ? 'bg-accent-500/20 text-accent-300 shadow-sm'
                    : 'text-text-muted hover:text-text-secondary'
                }`}
                onClick={() => setSortMode('nearest')}
                disabled={isProcessing}
              >
                近い順
              </button>
              <button
                type="button"
                className={`rounded-md px-2.5 py-1.5 text-[0.65rem] font-medium transition-all ${
                  sortMode === 'farthest'
                    ? 'bg-accent-500/20 text-accent-300 shadow-sm'
                    : 'text-text-muted hover:text-text-secondary'
                }`}
                onClick={() => setSortMode('farthest')}
                disabled={isProcessing}
              >
                遠い順
              </button>
            </div>
          </div>
          <textarea
            id="address-input"
            className="textarea-glass w-full px-4 py-3.5"
            rows={7}
            placeholder={PLACEHOLDER}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            disabled={isProcessing}
            spellCheck={false}
          />
        </div>

        {/* --- Action Buttons --- */}
        <div className="flex gap-3">
          <button
            id="optimize-button"
            className="btn-glow flex flex-1 items-center justify-center gap-2 px-5 py-3.5 text-sm"
            onClick={handleOptimize}
            disabled={
              isProcessing || !inputText.trim() || !departureText.trim()
            }
          >
            {isProcessing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                処理中...
              </>
            ) : (
              <>
                <Zap className="h-4 w-4" />
                ルートを最適化する（無料）
              </>
            )}
          </button>

          {status !== 'idle' && (
            <button
              id="reset-button"
              className="flex h-[3.25rem] w-[3.25rem] shrink-0 items-center justify-center rounded-xl border border-dark-500 text-text-secondary transition-colors hover:border-dark-400 hover:text-text-primary"
              onClick={handleReset}
              aria-label="リセット"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          )}
        </div>
      </section>

      {/* ===== Progress Bar ===== */}
      {status === 'geocoding' && progress && (
        <section className="mt-4 animate-fade-in-up glass-card p-4">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="animate-pulse-glow font-medium text-accent-400">
              住所を検索中...
            </span>
            <span className="text-text-muted">
              {progress.current} / {progress.total}
            </span>
          </div>
          <div className="progress-bar">
            <div
              className="progress-bar-fill"
              style={{
                width: `${(progress.current / progress.total) * 100}%`,
              }}
            />
          </div>
          <p className="mt-2 truncate text-xs text-text-muted">
            {progress.currentAddress}
          </p>
        </section>
      )}

      {status === 'optimizing' && (
        <section className="mt-4 animate-fade-in-up glass-card p-4">
          <div className="flex items-center gap-2 text-xs">
            <Loader2 className="h-4 w-4 animate-spin text-accent-400" />
            <span className="font-medium text-accent-400">
              最適なルートを計算中...
            </span>
          </div>
        </section>
      )}

      {/* ===== Error ===== */}
      {status === 'error' && errorMessage && (
        <section className="mt-4 animate-fade-in-up glass-card border-danger-500/30 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-danger-500" />
            <div>
              <p className="text-sm font-semibold text-danger-500">エラー</p>
              <p className="mt-1 text-xs leading-relaxed text-text-secondary">
                {errorMessage}
              </p>
            </div>
          </div>
        </section>
      )}

      {/* ===== Results ===== */}
      {status === 'done' && optimizedStops.length > 0 && (
        <section ref={resultRef} className="mt-5 animate-fade-in-up">
          {/* Summary */}
          <div className="glass-card mb-4 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-text-muted">
                  最適化完了
                </p>
                <p className="mt-0.5 text-lg font-bold text-text-primary">
                  {optimizedStops.length}
                  <span className="ml-1 text-sm font-normal text-text-secondary">
                    地点
                  </span>
                  {arrivalMode === 'same' && (
                    <span className="ml-1 text-[0.65rem] font-normal text-success-400">
                      +帰着
                    </span>
                  )}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs font-medium text-text-muted">
                  {routeMatrixUsed ? '総走行距離（実走）' : '総移動距離（直線）'}
                </p>
                <p className="mt-0.5 text-lg font-bold text-accent-400">
                  {totalDistance.toFixed(1)}
                  <span className="ml-0.5 text-sm font-normal text-text-secondary">
                    km
                  </span>
                </p>
              </div>
            </div>
            {routeMatrixUsed && totalDuration > 0 && (
              <div className="mt-3 flex items-center justify-between border-t border-dark-500/30 pt-3">
                <p className="text-xs font-medium text-text-muted">予想移動時間（車）</p>
                <p className="text-sm font-bold text-text-primary">{formatDuration(totalDuration)}</p>
              </div>
            )}
          </div>

          {/* Google Maps Button */}
          <button
            id="google-maps-button"
            className="btn-maps mb-4 flex w-full items-center justify-center gap-2.5 px-5 py-3.5 text-sm font-semibold"
            onClick={openGoogleMaps}
          >
            <Navigation className="h-4.5 w-4.5" />
            Googleマップでナビを開始
            <ExternalLink className="h-3.5 w-3.5 opacity-60" />
          </button>

          {/* Route List */}
          <div className="stagger-children space-y-2.5">
            {optimizedStops.map((stop, index) => {
              const isDeparture = index === 0;
              const isArrival =
                arrivalMode === 'different' &&
                index === optimizedStops.length - 1;

              return (
                <div key={index} className="result-card px-4 py-3.5">
                  <div className="flex items-center gap-3.5">
                    {/* Order badge */}
                    {isArrival ? (
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[0.625rem] bg-gradient-to-br from-blue-500 to-cyan-400 text-sm font-bold text-white">
                        🏁
                      </div>
                    ) : (
                      <div className="badge-order">{stop.order + 1}</div>
                    )}

                    {/* Content */}
                    <div className="min-w-0 flex-1">
                      {stop.point.label && (
                        <p className="truncate text-sm font-semibold text-text-primary">
                          {stop.point.label}
                        </p>
                      )}
                      <p
                        className={`truncate text-xs ${
                          stop.point.label
                            ? 'text-text-secondary'
                            : 'text-sm font-medium text-text-primary'
                        }`}
                      >
                        {stop.point.address}
                      </p>
                    </div>

                    {/* Distance or badge */}
                    {isDeparture && (
                      <span className="shrink-0 rounded-lg bg-success-500/15 px-2 py-1 text-[0.65rem] font-semibold text-success-400">
                        出発地
                      </span>
                    )}
                    {isArrival && (
                      <div className="shrink-0 text-right">
                        <div className="flex items-center gap-1 text-xs text-text-muted">
                          <ArrowRight className="h-3 w-3" />
                          <div className="flex flex-col items-end">
                            <span className="font-medium text-accent-400">
                              {stop.distanceFromPrev.toFixed(1)}km
                            </span>
                            {stop.durationFromPrev !== undefined && (
                              <span className="text-[0.65rem] text-text-muted">
                                {formatDuration(stop.durationFromPrev)}
                              </span>
                            )}
                          </div>
                        </div>
                        <span className="mt-0.5 inline-block rounded-md bg-blue-500/15 px-1.5 py-0.5 text-[0.6rem] font-semibold text-blue-400">
                          帰着地
                        </span>
                      </div>
                    )}
                    {!isDeparture && !isArrival && index > 0 && (
                      <div className="shrink-0 text-right">
                        <div className="flex items-center gap-1 text-xs text-text-muted">
                          <ArrowRight className="h-3 w-3" />
                          <div className="flex flex-col items-end">
                            <span className="font-medium text-accent-400">
                              {stop.distanceFromPrev.toFixed(1)}km
                            </span>
                            {stop.durationFromPrev !== undefined && (
                              <span className="text-[0.65rem] text-text-muted">
                                {formatDuration(stop.durationFromPrev)}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Round trip return card */}
            {arrivalMode === 'same' && optimizedStops.length > 1 && (
              <div className="result-card border-success-500/20 px-4 py-3.5">
                <div className="flex items-center gap-3.5">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[0.625rem] bg-gradient-to-br from-success-500 to-emerald-400 text-sm font-bold text-white">
                    🏠
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-text-primary">
                      出発地に戻る
                    </p>
                    <p className="truncate text-xs text-text-secondary">
                      {optimizedStops[0].point.address}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="flex items-center gap-1 text-xs text-text-muted">
                      <ArrowRight className="h-3 w-3" />
                      <div className="flex flex-col items-end">
                        <span className="font-medium text-accent-400">
                          {returnDistance.toFixed(1)}km
                        </span>
                        {routeMatrixUsed && returnDuration > 0 && (
                          <span className="text-[0.65rem] text-text-muted">
                            {formatDuration(returnDuration)}
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="mt-0.5 inline-block rounded-md bg-success-500/15 px-1.5 py-0.5 text-[0.6rem] font-semibold text-success-400">
                      帰着
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Copy Route Button */}
          <button
            id="copy-route-button"
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-dark-500 px-4 py-3 text-xs font-medium text-text-secondary transition-colors hover:border-dark-400 hover:text-text-primary"
            onClick={handleCopyRoute}
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-success-400" />
                <span className="text-success-400">コピーしました！</span>
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                ルート順をテキストでコピー
              </>
            )}
          </button>

          {/* Failed entries warning */}
          {failedEntries.length > 0 && (
            <div className="mt-4 rounded-xl border border-warning-500/20 bg-warning-500/5 p-3.5">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning-500" />
                <div>
                  <p className="text-xs font-semibold text-warning-500">
                    {failedEntries.length}件の住所が見つかりませんでした
                  </p>
                  <ul className="mt-1.5 space-y-0.5">
                    {failedEntries.map((entry, i) => (
                      <li
                        key={i}
                        className="truncate text-[0.7rem] text-text-muted"
                      >
                        ・{entry}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Footer */}
      <footer className="mt-8 pb-6 text-center">
        <p className="text-[0.65rem] leading-relaxed text-text-muted">
          住所検索:
          {' '}
          <a
            href="https://www.gsi.go.jp/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent-400/70 hover:text-accent-400"
          >
            国土地理院
          </a>
          {' '}住所検索API
        </p>
      </footer>
    </main>
  );
}
