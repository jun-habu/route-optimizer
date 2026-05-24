import { useState, useCallback } from 'react';
import { Route, HelpCircle, X, ClipboardCopy, MapPin, Zap, Navigation } from 'lucide-react';

export function Header() {
  const [showHelp, setShowHelp] = useState(false);

  const toggleHelp = useCallback(() => {
    setShowHelp((prev) => !prev);
  }, []);

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-glass-border bg-dark-900/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-accent-500 to-purple-500">
              <Route className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-base font-bold leading-tight tracking-tight text-text-primary">
                最速巡回コピペくん
              </h1>
              <p className="text-[0.65rem] font-medium text-text-muted">
                無料ルート最適化ツール
              </p>
            </div>
          </div>
          <button
            id="help-button"
            onClick={toggleHelp}
            className="flex h-9 w-9 items-center justify-center rounded-xl text-text-secondary transition-colors hover:bg-dark-600 hover:text-text-primary"
            aria-label="使い方を表示"
          >
            <HelpCircle className="h-5 w-5" />
          </button>
        </div>
      </header>

      {showHelp && (
        <div className="modal-overlay" onClick={toggleHelp}>
          <div
            className="modal-content"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-bold text-text-primary">使い方</h2>
              <button
                id="help-close-button"
                onClick={toggleHelp}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-dark-600 hover:text-text-primary"
                aria-label="閉じる"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-5">
              <HelpStep
                icon={<ClipboardCopy className="h-5 w-5" />}
                step={1}
                title="出発地・帰着地・訪問先を入力"
                description="出発地と帰着地を設定し、訪問先の住所をメモ帳やメールからそのまま貼り付けます。帰着地は出発地に戻るか、別の場所を指定できます。"
              />
              <HelpStep
                icon={<Zap className="h-5 w-5" />}
                step={2}
                title="ルートを最適化"
                description="ボタンを押すと、住所を自動解析→緯度経度を取得→最短ルートを計算。すべて無料APIとブラウザ内処理で完結します。"
              />
              <HelpStep
                icon={<MapPin className="h-5 w-5" />}
                step={3}
                title="結果を確認"
                description="最適化された順番でカード形式に表示。各地点間の距離も一目でわかります。"
              />
              <HelpStep
                icon={<Navigation className="h-5 w-5" />}
                step={4}
                title="ナビを開始"
                description="「Googleマップでナビ開始」ボタンで、最適化済みの全経由地をGoogleマップに一括連携。そのままナビを始められます。"
              />
            </div>

            <div className="mt-6 rounded-xl bg-dark-800 p-3.5">
              <p className="text-xs leading-relaxed text-text-muted">
                <span className="font-semibold text-accent-400">💡 ヒント：</span>
                企業名や会社番号が混ざっていても大丈夫！住所部分だけを自動で抽出します。都道府県名は省略してもOKです。
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function HelpStep({
  icon,
  step,
  title,
  description,
}: {
  icon: React.ReactNode;
  step: number;
  title: string;
  description: string;
}) {
  return (
    <div className="flex gap-3.5">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-500/15 text-accent-400">
        {icon}
      </div>
      <div>
        <p className="text-sm font-semibold text-text-primary">
          <span className="mr-1.5 text-accent-400">Step {step}</span>
          {title}
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-text-secondary">
          {description}
        </p>
      </div>
    </div>
  );
}
