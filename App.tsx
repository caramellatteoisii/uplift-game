/**
 * 顧客を救え！ v1.5 - アップリフトモデリング学習ゲーム
 *
 * v1.1: 難易度選択 / ベストスコア(localStorage) / フリップカードアニメーション
 * v1.2: 全顧客答え合わせ / 理想解・達成率パネル
 * v1.3: UI改善 — グレーアウト廃止 / 選択カウンター刷新 / 上限警告トースト / ボタン条件変更
 * v1.4: 選択UI改善 — 上限撤廃（何人でも選択可）/ 超過時は赤色警告 + メッセージ / ボタンは5人ちょうどのみ有効
 * v1.5: Easyモード結果画面改善 — フリップカード裏面にヒント＋タイプ別学習コメントを表示
 * v1.6: 結果発表モーダル — 分析中→カウントアップ→コメント→詳細ボタンの段階演出
 * v1.7: 結果画面スクロール改善 / Lost Causeスコア表示バグ修正（absolute廃止）
 * v1.8: 理想顧客詳細モーダル — TOP5カードタップで属性・ヒント・学習コメントを表示
 * v1.9: 全顧客答え合わせUI刷新 — スリム一覧 + 行タップで詳細モーダル表示
 * v2.0: Hardモード改善 — 6つの行動特徴量を追加、タイプとゆるく相関させて分析体験を提供
 * v2.1: HardCustomerFeatures 共通コンポーネント追加 / 結果画面「選択した顧客の結果」にHard行動特徴量を表示
 * v2.1b: Hardモード結果カード刷新 — コンパクトカード + 分析モーダル（フリップ廃止）
 */

import { useState, useCallback, useEffect, useMemo, useRef } from "react";

// ─────────────────────────────────────────────
// 型定義
// ─────────────────────────────────────────────

type CustomerType = "Persuadable" | "Sure Thing" | "Lost Cause" | "Sleeping Dog";
type Difficulty   = "easy" | "hard";
type Screen       = "intro" | "title" | "game" | "result";

/** タイプフィルタ（全顧客テーブル用） */
type TypeFilter = CustomerType | "all";

/**
 * Hardモード専用の行動特徴量
 * タイプとゆるく相関するが、単一特徴では判断できないよう設計
 */
interface HardStats {
  daysSinceLastPurchase: number; // 最終購入日からの日数
  emailOpenRate: number;         // メール開封率（%）
  appUsagePerWeek: number;       // アプリ利用頻度（回/週）
  campaignViewsPerMonth: number; // キャンペーン閲覧回数（回/月）
  couponUsageCount: number;      // クーポン利用回数（過去6ヶ月）
  storeVisitsPerMonth: number;   // 来店頻度（回/月）
}

interface Customer {
  id: string;
  name: string;
  age: number;
  income: number;
  purchaseCount: number;
  type: CustomerType;
  hint?: string;       // Easy 限定ヒント
  hardStats?: HardStats; // Hard 限定行動特徴量
}

// ─────────────────────────────────────────────
// 定数
// ─────────────────────────────────────────────

const TOTAL_CUSTOMERS = 20;
const MAX_SELECTION   = 5;
const LS_KEY_PREFIX   = "uplift_best_score_";

const TYPE_SCORE: Record<CustomerType, number> = {
  Persuadable:    100,
  "Sure Thing":    20,
  "Lost Cause":     0,
  "Sleeping Dog": -100,
};

/** 各タイプのビジュアル設定 */
const TYPE_META: Record<CustomerType, {
  emoji: string; circleColor: string; label: string; result: string;
  color: string; bg: string; border: string; flipBg: string;
  dotClass: string; // 全顧客テーブル用ドット色
}> = {
  Persuadable: {
    emoji: "🎯", circleColor: "#10b981", label: "Persuadable",
    result: "施策によって購入した（理想の顧客！）",
    color: "text-emerald-700", bg: "bg-emerald-50",
    border: "border-emerald-300", flipBg: "#d1fae5",
    dotClass: "bg-emerald-500",
  },
  "Sure Thing": {
    emoji: "✅", circleColor: "#0ea5e9", label: "Sure Thing",
    result: "施策なしでも購入していた",
    color: "text-sky-700", bg: "bg-sky-50",
    border: "border-sky-300", flipBg: "#e0f2fe",
    dotClass: "bg-sky-500",
  },
  "Lost Cause": {
    emoji: "😶", circleColor: "#94a3b8", label: "Lost Cause",
    result: "施策があっても購入しなかった",
    color: "text-slate-500", bg: "bg-slate-50",
    border: "border-slate-200", flipBg: "#f1f5f9",
    dotClass: "bg-slate-400",
  },
  "Sleeping Dog": {
    emoji: "⚠️", circleColor: "#f43f5e", label: "Sleeping Dog",
    result: "施策によって逆に購入しなくなった",
    color: "text-rose-700", bg: "bg-rose-50",
    border: "border-rose-300", flipBg: "#fee2e2",
    dotClass: "bg-rose-500",
  },
};

const TYPE_WEIGHTS: { type: CustomerType; weight: number }[] = [
  { type: "Persuadable",   weight: 30 },
  { type: "Sure Thing",    weight: 30 },
  { type: "Lost Cause",    weight: 30 },
  { type: "Sleeping Dog",  weight: 10 },
];

/**
 * Persuadable の固定人数。
 * 20名中ちょうどこの人数を Persuadable にすることで、
 * 理論上の最高スコアを毎回 PERSUADABLE_FIXED_COUNT × 100点 に統一する。
 */
const PERSUADABLE_FIXED_COUNT = 5;

/** Persuadable 以外の3タイプの出現比率（残り15名の割当に使用） */
const NON_PERSUADABLE_WEIGHTS: { type: CustomerType; weight: number }[] =
  TYPE_WEIGHTS.filter(w => w.type !== "Persuadable");

const CUSTOMER_NAMES = [
  "田中","佐藤","鈴木","高橋","伊藤",
  "渡辺","山本","中村","小林","加藤",
  "吉田","山田","佐々木","山口","松本",
  "井上","木村","林","斎藤","清水",
];

const EASY_HINTS: Record<CustomerType, string[]> = {
  Persuadable:   ["過去にセール時のみ購入している","メルマガ開封率が高い","クーポン利用率が高め","価格感度が高い傾向"],
  "Sure Thing":  ["定期的に自発購入している","リピート購入が多い常連","会員ランクが高い","自発的な口コミ投稿あり"],
  "Lost Cause":  ["最終購入から1年以上経過","過去のDMへの反応なし","休眠顧客フラグあり","アプリの最終起動が半年前"],
  "Sleeping Dog":["DMを受け取ると返品率が上がる傾向","プロモーション直後に退会した履歴あり","セール時の購入が少ない","過去施策後に購入が減った記録あり"],
};

// ─────────────────────────────────────────────
// ユーティリティ
// ─────────────────────────────────────────────

/**
 * Hardモード用の行動特徴量を生成する。
 *
 * 設計方針:
 *   - 各特徴量はタイプとゆるく相関する（傾向はあるが断定はできない）
 *   - ノイズを加えることで「単一特徴だけでは判断できない」難易度を実現
 *   - Sleeping Dog は Persuadable に近い値を持つ項目があり、意図的な罠になっている
 *
 * 相関サマリー:
 *   特徴量              Persuadable  Sure Thing  Lost Cause  Sleeping Dog
 *   メール開封率(%)      高(60-90)   中(40-70)   低(10-45)   中高(50-80) ← 罠
 *   キャンペーン閲覧     多(3-8)     中(2-5)     少(0-2)     多(3-7)    ← 罠
 *   クーポン利用         少中(1-4)   少(0-2)     少(0-1)     最少(0-1)  ← 鍵
 *   最終購入(日前)       中(14-60)   最近(1-30)  古(90-365)  中(20-90)
 *   アプリ利用(回/週)    中高(2-4)   高(3-5)     低(0-1)     中(1-3)
 *   来店頻度(回/月)      中(1-3)     高(2-5)     低(0-1)     中(1-3)    ← 罠
 */
function generateHardStats(type: CustomerType): HardStats {
  // ノイズ: -noise〜+noise の範囲でランダムに加算
  const noise = (range: number) => (Math.random() - 0.5) * 2 * range;
  const clamp = (v: number, min: number, max: number) =>
    Math.round(Math.min(max, Math.max(min, v)));

  switch (type) {
    case "Persuadable":
      return {
        daysSinceLastPurchase: clamp(37 + noise(23), 14, 60),
        emailOpenRate:         clamp(75 + noise(15), 50, 92),
        appUsagePerWeek:       clamp(3 + noise(1),   2,  5),
        campaignViewsPerMonth: clamp(5 + noise(2),   3,  8),
        couponUsageCount:      clamp(2 + noise(1),   1,  4),  // やや多め ← 鍵
        storeVisitsPerMonth:   clamp(2 + noise(1),   1,  3),
      };
    case "Sure Thing":
      return {
        daysSinceLastPurchase: clamp(15 + noise(14), 1,  30), // 最近 ← 鍵
        emailOpenRate:         clamp(55 + noise(15), 35, 72),
        appUsagePerWeek:       clamp(4 + noise(1),   3,  5),  // 高め
        campaignViewsPerMonth: clamp(3 + noise(1.5), 2,  5),
        couponUsageCount:      clamp(1 + noise(1),   0,  2),  // 少ない（自発購入）← 鍵
        storeVisitsPerMonth:   clamp(3 + noise(1.5), 2,  5),  // 高め ← 鍵
      };
    case "Lost Cause":
      return {
        daysSinceLastPurchase: clamp(200 + noise(80), 90, 365), // 古い ← 鍵
        emailOpenRate:         clamp(27 + noise(17),  8,  45),  // 低い ← 鍵
        appUsagePerWeek:       clamp(0.5 + noise(0.5), 0, 1),
        campaignViewsPerMonth: clamp(1 + noise(1),    0,  2),
        couponUsageCount:      clamp(0 + noise(0.5),  0,  1),
        storeVisitsPerMonth:   clamp(0.5 + noise(0.5), 0, 1),
      };
    case "Sleeping Dog":
      return {
        // Persuadable に近い値で偽装するが微妙に違う
        daysSinceLastPurchase: clamp(50 + noise(30), 20, 90),
        emailOpenRate:         clamp(65 + noise(15), 48, 82),  // 開くが行動しない ← 罠
        appUsagePerWeek:       clamp(2 + noise(1),   1,  3),
        campaignViewsPerMonth: clamp(5 + noise(2),   3,  7),   // 閲覧多いが反応悪い ← 罠
        couponUsageCount:      clamp(0 + noise(0.5), 0,  1),   // ほぼ使わない ← 鍵
        storeVisitsPerMonth:   clamp(2 + noise(1),   1,  3),
      };
  }
}

/**
 * Persuadable 以外の3タイプから重み付きランダムで1つ選ぶ。
 * 残り15名分の割当に使用する。
 */
function weightedRandomNonPersuadable(): CustomerType {
  const total = NON_PERSUADABLE_WEIGHTS.reduce((s, w) => s + w.weight, 0);
  let rand = Math.random() * total;
  for (const { type, weight } of NON_PERSUADABLE_WEIGHTS) {
    rand -= weight;
    if (rand <= 0) return type;
  }
  return "Lost Cause";
}

/** Fisher-Yates シャッフル（配列をその場で破壊的にシャッフルして返す） */
function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 20名分のタイプ配列を生成する。
 *
 * 設計方針（保守性のため2処理を明確に分離）:
 *   1. Persuadable を PERSUADABLE_FIXED_COUNT 名だけ確定で用意する
 *   2. 残り (TOTAL_CUSTOMERS - PERSUADABLE_FIXED_COUNT) 名を
 *      Sure Thing / Lost Cause / Sleeping Dog からランダムに割り当てる
 *   3. 最後に全体をシャッフルし、Persuadable が先頭に固まらないようにする
 *      （顧客IDの若い番号に偏らないようにするため）
 *
 * これにより、理論上の最高スコア（理想解 TOP5 が全員 Persuadable の場合）は
 * 常に PERSUADABLE_FIXED_COUNT × 100点 = 500点 に統一される。
 */
function assignCustomerTypes(): CustomerType[] {
  // 1. Persuadable を固定人数ぶん用意
  const persuadableTypes: CustomerType[] =
    Array.from({ length: PERSUADABLE_FIXED_COUNT }, () => "Persuadable");

  // 2. 残り人数を Persuadable 以外の3タイプへランダム割当
  const remainingCount = TOTAL_CUSTOMERS - PERSUADABLE_FIXED_COUNT;
  const remainingTypes: CustomerType[] =
    Array.from({ length: remainingCount }, () => weightedRandomNonPersuadable());

  // 3. 結合してシャッフル（Persuadable が顧客ID順で偏らないように）
  return shuffleArray([...persuadableTypes, ...remainingTypes]);
}

function generateCustomers(difficulty: Difficulty): Customer[] {
  // v2.x: Persuadable の人数を固定するため、先にタイプ配列を一括生成する
  const types = assignCustomerTypes();

  return Array.from({ length: TOTAL_CUSTOMERS }, (_, i) => {
    const type  = types[i];
    const hints = EASY_HINTS[type];
    return {
      id:            `C${String(i + 1).padStart(2, "0")}`,
      name:          CUSTOMER_NAMES[i] + "さん",
      age:           Math.floor(Math.random() * 40) + 22,
      income:        Math.floor(Math.random() * 700) + 200,
      purchaseCount: Math.floor(Math.random() * 15),
      type,
      hint: difficulty === "easy"
        ? hints[Math.floor(Math.random() * hints.length)]
        : undefined,
      // v2.0: Hardモードのみ行動特徴量を生成
      hardStats: difficulty === "hard" ? generateHardStats(type) : undefined,
    };
  });
}

function getEvaluationComment(customers: Customer[]): string {
  const p  = customers.filter(c => c.type === "Persuadable").length;
  const st = customers.filter(c => c.type === "Sure Thing").length;
  const sd = customers.filter(c => c.type === "Sleeping Dog").length;
  const score = customers.reduce((s, c) => s + TYPE_SCORE[c.type], 0);
  if (sd >= 2)    return "施策が逆効果の顧客が含まれていました。購入歴が多い顧客でも、アプローチで離れる場合があります。";
  if (p  >= 3)    return "素晴らしい！施策によって行動が変わる顧客を多く見つけられました。これがアップリフトの理想です！";
  if (st >= 3)    return "購入しそうな顧客を選びましたが、施策効果は限定的でした。「どうせ買う人」へのクーポンはコストの無駄遣いです。";
  if (score >= 200) return "良い判断です！購入確率だけでなく、施策の効き目も意識できていますね。";
  return "もう一度試してみましょう。「施策によって行動が変わる顧客」に注目してみてください。";
}

function loadBestScore(difficulty: Difficulty): number | null {
  try {
    const raw = localStorage.getItem(LS_KEY_PREFIX + difficulty);
    return raw !== null ? Number(raw) : null;
  } catch { return null; }
}

function saveBestScore(difficulty: Difficulty, score: number): boolean {
  try {
    const prev = loadBestScore(difficulty);
    if (prev === null || score > prev) {
      localStorage.setItem(LS_KEY_PREFIX + difficulty, String(score));
      return true;
    }
    return false;
  } catch { return false; }
}

/**
 * 全顧客からスコア順で最適な MAX_SELECTION 人を求める
 * 同スコアは先着（IDの若い順）
 */
function computeOptimalSelection(allCustomers: Customer[]): Customer[] {
  return [...allCustomers]
    .sort((a, b) => TYPE_SCORE[b.type] - TYPE_SCORE[a.type])
    .slice(0, MAX_SELECTION);
}

// ─────────────────────────────────────────────
// フック: useTypewriter
//
// 再利用可能なタイプライター演出フック。
// テキストを1文字ずつ表示し、スキップ機能を提供する。
// 今後のチュートリアル・イベント画面でも使い回せる設計。
//
// 戻り値:
//   displayedText — 現在表示すべき文字列（途中経過 or 全文）
//   isTyping      — タイプ中かどうか
//   skip          — 即座に全文表示するための関数
// ─────────────────────────────────────────────
function useTypewriter(fullText: string, speedMs: number = 28) {
  const [displayedText, setDisplayedText] = useState("");
  const [isTyping, setIsTyping] = useState(true);

  useEffect(() => {
    setDisplayedText("");
    setIsTyping(true);

    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setDisplayedText(fullText.slice(0, i));
      if (i >= fullText.length) {
        clearInterval(id);
        setIsTyping(false);
      }
    }, speedMs);

    return () => clearInterval(id);
  }, [fullText, speedMs]);

  const skip = useCallback(() => {
    setDisplayedText(fullText);
    setIsTyping(false);
  }, [fullText]);

  return { displayedText, isTyping, skip };
}

// ─────────────────────────────────────────────
// データ: 導入画面の会話シナリオ
//
// 配列で管理し、今後セリフの追加・変更・分岐を行いやすくする。
// ─────────────────────────────────────────────
const INTRO_DIALOGUE: string[] = [
  "お疲れさま！ちょっといいかな？",
  "来月から始まる夏のセールのことなんだけど……",
  "お客様に10%OFFクーポンを配布したいと考えています。",
  "ただ、予算の都合で全員には送れません。",
  "そこで、あなたにお願いがあります。",
  "クーポンを送ることで購入する可能性が高まるお客様を、5人選んでください。",
  "顧客データを分析して、売上アップにつながるお客様を見つけましょう！",
  "あなたの分析に期待しています！",
];

// ─────────────────────────────────────────────
// コンポーネント: 導入画面（ミッション説明・会話演出）
//
// ゲーム起動後の最初の画面。
// マーケティング部長との会話を1メッセージずつタイプライター表示で進行する。
// 最後のメッセージで「ゲーム開始」ボタンに切り替わり、TitleScreen へ遷移する。
//
// 独立コンポーネントとして実装し、会話データ（INTRO_DIALOGUE）と
// タイプライター演出（useTypewriter）はそれぞれ再利用可能な形で分離している。
// ─────────────────────────────────────────────
function IntroScreen({ onNext }: { onNext: () => void }) {
  const [messageIndex, setMessageIndex] = useState(0);
  const isLastMessage = messageIndex === INTRO_DIALOGUE.length - 1;

  const { displayedText, isTyping, skip } = useTypewriter(INTRO_DIALOGUE[messageIndex]);

  // 画面タップ: タイプ中ならスキップ、全文表示済みなら何もしない（誤操作防止）
  const handleScreenTap = useCallback(() => {
    if (isTyping) skip();
  }, [isTyping, skip]);

  // 「次へ」/「ゲーム開始」ボタン
  const handleAdvance = useCallback(() => {
    if (isTyping) {
      // タイプ中にボタンを押した場合もスキップ優先
      skip();
      return;
    }
    if (isLastMessage) {
      onNext();
    } else {
      setMessageIndex(i => i + 1);
    }
  }, [isTyping, isLastMessage, skip, onNext]);

  return (
    <div
      className="min-h-screen bg-slate-50 flex flex-col items-center justify-center px-4 py-8"
      onClick={handleScreenTap}
    >
      <div className="w-full max-w-sm">

        {/* ── 会社ブランドヘッダー ── */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-2 bg-indigo-600 text-white
              px-4 py-1.5 rounded-full text-xs font-bold mb-3 tracking-wide">
            <span>🏢</span><span>82 Closet</span>
          </div>
          <h1 className="text-xl font-black text-slate-800 leading-tight">
            マーケティング部から依頼
          </h1>
        </div>

        {/* ── チャット風会話カード ── */}
        <div className="bg-white rounded-3xl shadow-md border border-slate-100 overflow-hidden mb-4">

          {/* 発言者バー */}
          <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-100 bg-slate-50">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center text-xl shrink-0">
                👩‍💼
              </div>
              <div>
                <div className="text-xs text-slate-400 font-mono">FROM</div>
                <div className="text-sm font-bold text-slate-700">マーケティング部長</div>
              </div>
            </div>
            {/* 進行ドット */}
            <div className="flex items-center gap-1 shrink-0">
              {INTRO_DIALOGUE.map((_, i) => (
                <div
                  key={i}
                  className="rounded-full transition-all duration-200"
                  style={{
                    width: i === messageIndex ? 14 : 5,
                    height: 5,
                    backgroundColor: i <= messageIndex ? "#6366f1" : "#e2e8f0",
                  }}
                />
              ))}
            </div>
          </div>

          {/* 吹き出し本文（タイプライター表示） */}
          <div className="px-5 py-6 min-h-[120px] flex items-center">
            <div className="bg-indigo-50 rounded-2xl rounded-tl-sm px-4 py-3.5 w-full">
              <p className="text-sm text-slate-800 leading-relaxed whitespace-pre-line">
                {displayedText}
                {isTyping && (
                  <span className="inline-block w-1.5 h-4 bg-indigo-400 ml-0.5 align-middle"
                    style={{ animation: "blink 0.8s step-end infinite" }} />
                )}
              </p>
            </div>
          </div>

          {/* タップ誘導テキスト（タイプ中のみ） */}
          {isTyping && (
            <div className="text-center pb-3">
              <span className="text-xs text-slate-300">タップしてスキップ</span>
            </div>
          )}
        </div>

        {/* ── 次へ / ゲーム開始ボタン ── */}
        <button
          onClick={(e) => { e.stopPropagation(); handleAdvance(); }}
          className="w-full py-4 rounded-2xl font-black text-base text-white
            active:scale-[0.98] transition-all duration-200"
          style={{
            background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
            boxShadow: "0 4px 24px rgba(99,102,241,0.35)",
          }}
        >
          {isLastMessage ? "ゲーム開始 →" : "次へ →"}
        </button>

        {!isLastMessage && (
          <p className="text-center text-xs text-slate-400 mt-3">
            {messageIndex + 1} / {INTRO_DIALOGUE.length}
          </p>
        )}
      </div>

      {/* タイプライターカーソル用 CSS キーフレーム */}
      <style>{`@keyframes blink { 50% { opacity: 0; } }`}</style>
    </div>
  );
}

// ─────────────────────────────────────────────
// コンポーネント: タイトル画面（難易度選択）
// ─────────────────────────────────────────────
function TitleScreen({ onStart }: { onStart: (d: Difficulty) => void }) {
  const [selected, setSelected] = useState<Difficulty>("easy");
  const easyBest = loadBestScore("easy");
  const hardBest = loadBestScore("hard");

  const diffs: { key: Difficulty; icon: string; label: string; badge: string; desc: string }[] = [
    { key: "easy", icon: "🌱", label: "Easy", badge: "初心者向け", desc: "各顧客に「行動傾向ヒント」が表示されます" },
    { key: "hard", icon: "🔥", label: "Hard", badge: "上級者向け", desc: "属性（年齢・年収・購入回数）だけで判断" },
  ];

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 relative overflow-hidden"
      style={{ background: "linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)" }}>
      <div className="absolute inset-0 pointer-events-none">
        {Array.from({ length: 30 }).map((_, i) => (
          <div key={i} className="absolute rounded-full bg-white"
            style={{ opacity: Math.random() * 0.3 + 0.05,
              width: `${Math.random() * 2 + 1}px`, height: `${Math.random() * 2 + 1}px`,
              top: `${Math.random() * 100}%`, left: `${Math.random() * 100}%` }} />
        ))}
      </div>

      <div className="relative z-10 w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-indigo-400 text-xs font-mono tracking-widest uppercase mb-2">Uplift Modeling Game v2.1</div>
          <h1 className="text-5xl font-black text-white mb-3 leading-tight">顧客を救え！</h1>
          <div className="w-12 h-1 bg-indigo-500 mx-auto rounded-full" />
        </div>

        <div className="bg-white/10 border border-white/20 rounded-2xl p-4 mb-6 text-sm text-slate-300 leading-relaxed">
          クーポンを配布する顧客を最大<span className="text-yellow-300 font-bold">5人</span>選んでください。
          <span className="text-indigo-300 font-semibold">「施策によって行動が変わる顧客」</span>を見つけることが重要です。
        </div>

        <div className="mb-6">
          <div className="text-xs text-slate-400 font-mono tracking-widest uppercase mb-3">難易度を選択</div>
          <div className="space-y-2">
            {diffs.map(d => (
              <button key={d.key} onClick={() => setSelected(d.key)}
                className={`w-full text-left rounded-2xl p-4 border-2 transition-all duration-150
                  ${selected === d.key ? "border-indigo-400 bg-indigo-900/50" : "border-white/10 bg-white/5 hover:border-white/30"}`}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{d.icon}</span>
                    <span className="font-black text-white text-base">{d.label}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-bold
                      ${d.key === "easy" ? "bg-emerald-500/30 text-emerald-300" : "bg-rose-500/30 text-rose-300"}`}>
                      {d.badge}
                    </span>
                  </div>
                  {(d.key === "easy" ? easyBest : hardBest) !== null && (
                    <span className="text-xs text-yellow-400 font-mono">Best: {d.key === "easy" ? easyBest : hardBest}pt</span>
                  )}
                </div>
                <p className="text-slate-400 text-xs ml-7">{d.desc}</p>
                {selected === d.key && (
                  <div className="flex items-center gap-1.5 ml-7 mt-2">
                    <div className="w-2 h-2 rounded-full bg-indigo-400" />
                    <span className="text-indigo-400 text-xs font-bold">選択中</span>
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>

        <button onClick={() => onStart(selected)}
          className="w-full py-4 rounded-2xl font-black text-lg text-white transition-all duration-200 active:scale-95"
          style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)", boxShadow: "0 0 30px rgba(99,102,241,0.4)" }}>
          {selected === "easy" ? "🌱" : "🔥"} ゲームスタート →
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// ヘルパー: HardStats の表示用ラベル・値フォーマット
// ─────────────────────────────────────────────

/** hardStats の各フィールドを表示用ラベルと値文字列に変換 */
function formatHardStats(s: HardStats): { label: string; value: string; sub?: string }[] {
  return [
    { label: "最終購入",      value: `${s.daysSinceLastPurchase}日前` },
    { label: "メール開封率",  value: `${s.emailOpenRate}%` },
    { label: "アプリ利用",    value: `週${s.appUsagePerWeek}回` },
    { label: "キャンペーン閲覧", value: `月${s.campaignViewsPerMonth}回` },
    { label: "クーポン利用",  value: `${s.couponUsageCount}回` },
    { label: "来店頻度",      value: `月${s.storeVisitsPerMonth}回` },
  ];
}

// ─────────────────────────────────────────────
// 【v2.1】共通コンポーネント: HardCustomerFeatures
//
// Hardモードで生成される行動特徴量（HardStats）を
// 顧客の基本属性と合わせて表示する再利用可能なコンポーネント。
//
// 使用予定箇所（次バージョン以降で順次組み込み）:
//   - 結果画面: フリップカード裏面
//   - 理想解パネル: 顧客詳細モーダル
//   - 全顧客答え合わせ: 顧客詳細モーダル
//
// Props:
//   customer  — Customer オブジェクト（hardStats がない場合は非表示）
//   variant   — "grid"（カードグリッド）| "list"（ラベル+値リスト）
//   showBasic — 基本属性（年齢・年収・購入回数）も表示するか
//   className — 外側への追加クラス
// ─────────────────────────────────────────────

type HardCustomerFeaturesVariant = "grid" | "list";

interface HardCustomerFeaturesProps {
  customer: Customer;
  variant?: HardCustomerFeaturesVariant;
  showBasic?: boolean;
  className?: string;
}

/**
 * 基本属性を表示用の { label, value } 配列に変換
 */
function formatBasicStats(c: Customer): { label: string; value: string }[] {
  return [
    { label: "年齢",    value: `${c.age}歳` },
    { label: "年収",    value: `${c.income}万円` },
    { label: "購入回数", value: `${c.purchaseCount}回` },
  ];
}

/**
 * HardCustomerFeatures
 *
 * variant="grid"  → 3列グリッドのセル形式（カード内・コンパクト表示向け）
 * variant="list"  → ラベル左・値右のリスト形式（モーダル・詳細画面向け）
 *
 * hardStats が存在しない場合（Easyモード）は null を返す。
 */
function HardCustomerFeatures({
  customer,
  variant = "list",
  showBasic = true,
  className = "",
}: HardCustomerFeaturesProps) {
  const hs = customer.hardStats;

  // hardStats が存在しない顧客（Easyモード）は何も表示しない
  if (!hs) return null;

  const basicRows  = showBasic ? formatBasicStats(customer) : [];
  const hardRows   = formatHardStats(hs);

  // ── grid バリアント（3列セル形式） ──────────────────
  if (variant === "grid") {
    return (
      <div className={className}>
        {/* 基本属性グリッド */}
        {showBasic && (
          <div className="grid grid-cols-3 gap-2 mb-3">
            {basicRows.map(({ label, value }) => (
              <div key={label} className="bg-slate-100 rounded-lg p-2 text-center">
                <div className="text-xs text-slate-500 mb-0.5">{label}</div>
                <div className="text-sm font-bold text-slate-700">{value}</div>
              </div>
            ))}
          </div>
        )}

        {/* 区切り線 + 行動データラベル */}
        <div className="flex items-center gap-1.5 mb-2">
          <div className="h-px flex-1 bg-slate-200" />
          <span className="text-xs text-slate-400 font-bold tracking-wider">📊 行動データ</span>
          <div className="h-px flex-1 bg-slate-200" />
        </div>

        {/* 行動特徴量グリッド */}
        <div className="grid grid-cols-3 gap-1.5">
          {hardRows.map(({ label, value }) => (
            <div key={label} className="bg-slate-50 border border-slate-100 rounded-lg p-1.5 text-center">
              <div className="text-slate-400 leading-tight mb-0.5" style={{ fontSize: "10px" }}>{label}</div>
              <div className="text-xs font-bold text-slate-700">{value}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── list バリアント（ラベル+値リスト形式） ────────────
  // 基本属性と行動データをセクション分けして表示
  const sections: { heading: string; icon: string; rows: { label: string; value: string }[] }[] = [
    ...(showBasic ? [{ heading: "基本属性", icon: "👤", rows: basicRows }] : []),
    { heading: "行動データ", icon: "📊", rows: hardRows },
  ];

  return (
    <div className={`space-y-3 ${className}`}>
      {sections.map(({ heading, icon, rows }) => (
        <div key={heading} className="rounded-xl overflow-hidden border border-slate-200">
          {/* セクションヘッダー */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100">
            <span className="text-xs">{icon}</span>
            <span className="text-xs font-bold text-slate-600 tracking-wide">{heading}</span>
          </div>

          {/* 行 */}
          <div className="bg-white divide-y divide-slate-100">
            {rows.map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between px-3 py-2">
                <span className="text-xs text-slate-500">{label}</span>
                <span className="text-xs font-bold text-slate-800 tabular-nums">{value}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}


// ─────────────────────────────────────────────
// コンポーネント: CustomerCardPreview
//
// CustomerCard のデータ表示部分（基本属性グリッド + 行動データグリッド）を
// ボタン・チェックマーク・ヒントを除いた純粋な表示用コンポーネントとして抽出。
//
// 用途:
//   - ゲーム画面: CustomerCard 内部から呼び出し（同一グリッドUIを共有）
//   - 分析レポートモーダル: カードと完全一致した見た目で顧客データを表示
//
// ゲーム中のカードデザインを変更すると、モーダル側にも自動反映される。
// ─────────────────────────────────────────────
function CustomerCardPreview({ customer, showHeader = true }: { customer: Customer; showHeader?: boolean }) {
  const hs = customer.hardStats;
  return (
    <div>
      {/* 顧客ID + 名前（ゲーム画面では表示、モーダルでは非表示） */}
      {showHeader && (
        <>
          <div className="text-xs font-mono text-slate-400 mb-0.5">{customer.id}</div>
          <div className={`text-base font-bold text-slate-800 ${hs ? "mb-2" : "mb-3"}`}>{customer.name}</div>
        </>
      )}

      {/* 基本属性 3列グリッド */}
      <div className={`grid grid-cols-3 gap-2 ${hs ? "mb-3" : ""}`}>
        {[["年齢", `${customer.age}歳`], ["年収", `${customer.income}万円`], ["購入回数", `${customer.purchaseCount}回`]]
          .map(([label, value]) => (
            <div key={label} className="bg-slate-100 rounded-lg p-2 text-center">
              <div className="text-xs text-slate-500 mb-0.5">{label}</div>
              <div className="text-sm font-bold text-slate-700">{value}</div>
            </div>
          ))}
      </div>

      {/* Hard モード: 行動データ区切り + 3列グリッド */}
      {hs && (
        <>
          <div className="flex items-center gap-1.5 mb-2">
            <div className="h-px flex-1 bg-slate-200" />
            <span className="text-xs text-slate-400 font-bold tracking-wider">行動データ</span>
            <div className="h-px flex-1 bg-slate-200" />
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {formatHardStats(hs).map(({ label, value }) => (
              <div key={label} className="bg-slate-50 border border-slate-100 rounded-lg p-1.5 text-center">
                <div className="text-slate-400 leading-tight mb-0.5" style={{ fontSize: "10px" }}>{label}</div>
                <div className="text-xs font-bold text-slate-700">{value}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// コンポーネント: 顧客カード（ゲーム画面）
//
// v1.3: グレーアウト廃止 / 選択状態スタイル
// v2.0: Hard モード時に行動データセクションを追加表示
// v2.1b: 内部グリッドは CustomerCardPreview に委譲して共通化
// ─────────────────────────────────────────────
function CustomerCard({ customer, isSelected, onToggle }:
  { customer: Customer; isSelected: boolean; onToggle: (id: string) => void }) {

  return (
    <button
      onClick={() => onToggle(customer.id)}
      className={`
        relative w-full text-left rounded-2xl p-4 border-2 transition-all duration-150
        ${isSelected
          ? "border-indigo-500 bg-indigo-50 shadow-md shadow-indigo-100"
          : "border-slate-200 bg-white hover:border-indigo-300 hover:shadow-sm active:scale-[0.98]"
        }
      `}
    >
      {/* 選択済みチェックマーク */}
      {isSelected && (
        <div className="absolute top-3 right-3 w-6 h-6 rounded-full bg-indigo-500 flex items-center justify-center">
          <span className="text-white text-xs font-black">✓</span>
        </div>
      )}

      {/* データ表示部分は CustomerCardPreview に委譲 */}
      <CustomerCardPreview customer={customer} />

      {/* Easy モード: ヒント */}
      {customer.hint && (
        <div className="flex items-start gap-1.5 mt-3 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
          <span className="text-amber-500 text-xs mt-0.5 shrink-0">💡</span>
          <span className="text-amber-800 text-xs leading-relaxed">{customer.hint}</span>
        </div>
      )}
    </button>
  );
}

// ─────────────────────────────────────────────
// コンポーネント: ゲーム画面
//
// v1.3: グレーアウト廃止 / 選択カウンター / トースト警告
// v1.4: 上限撤廃（何人でも選択可）
//   - トースト・上限ガードを削除、onToggle を直接カードへ渡す
//   - カウンター: 不足(通常) / ちょうど(緑) / 超過(赤) の3段階
//   - ボタン: 5人未満→「あとX人」 / 5人→「結果を見る →」 / 超過→「5人に絞ってください」
// ─────────────────────────────────────────────
function GameScreen({ customers, selectedIds, difficulty, onToggle, onSubmit }:
  { customers: Customer[]; selectedIds: Set<string>; difficulty: Difficulty;
    onToggle: (id: string) => void; onSubmit: () => void }) {

  const count      = selectedIds.size;
  const isExact    = count === MAX_SELECTION;   // ちょうど5人 → 緑・ボタン有効
  const isOver     = count >  MAX_SELECTION;    // 超過 → 赤
  const canSubmit  = isExact;

  return (
    <div className="min-h-screen bg-slate-50">

      {/* ── スティッキーヘッダー ── */}
      <div className="sticky top-0 z-20 bg-white border-b border-slate-200 px-4 py-3 shadow-sm">
        <div className="max-w-2xl mx-auto flex items-center justify-between gap-3">

          {/* 左: タイトル + 難易度バッジ */}
          <div className="min-w-0">
            <div className="text-xs text-slate-400 font-mono flex items-center gap-1.5 flex-wrap">
              顧客を救え！
              <span className={`px-2 py-0.5 rounded-full text-xs font-bold
                ${difficulty === "easy" ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>
                {difficulty === "easy" ? "🌱 Easy" : "🔥 Hard"}
              </span>
            </div>
            <div className="text-sm font-bold text-slate-800">クーポン配布先を選択</div>
          </div>

          {/* 右: 選択カウンター（3段階）*/}
          <div className="shrink-0 text-right">
            {/* メインカウント */}
            <div className="text-base font-black leading-tight text-slate-800">
              選択中:{" "}
              <span className={`text-2xl font-black
                ${isExact ? "text-emerald-600" : isOver ? "text-rose-600" : "text-indigo-600"}`}>
                {count}
              </span>
              <span className="text-slate-400 font-normal text-sm"> / {MAX_SELECTION}</span>
            </div>
            {/* 補助テキスト */}
            {isOver ? (
              <div className="text-xs font-semibold text-rose-600 leading-tight">
                選択しすぎです<br />
                <span className="text-slate-400 font-normal">5人になるまで解除してください</span>
              </div>
            ) : isExact ? (
              <div className="text-xs font-semibold text-emerald-600 leading-tight">
                5人選択完了！<br />
                <span className="text-slate-400 font-normal">結果を確認できます</span>
              </div>
            ) : (
              <div className="text-xs text-slate-400 leading-tight">
                あと{MAX_SELECTION - count}人選べます
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── 顧客カードグリッド ── */}
      <div className="max-w-2xl mx-auto px-4 py-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-28">
          {customers.map(c => (
            <CustomerCard
              key={c.id}
              customer={c}
              isSelected={selectedIds.has(c.id)}
              onToggle={onToggle}
            />
          ))}
        </div>
      </div>

      {/* ── 固定フッター ── */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 p-4 shadow-lg">
        <div className="max-w-2xl mx-auto">
          <button
            onClick={onSubmit}
            disabled={!canSubmit}
            className={`
              w-full py-4 rounded-2xl font-black text-base transition-all duration-200
              ${canSubmit
                ? "bg-indigo-600 text-white active:scale-[0.98] shadow-md shadow-indigo-200"
                : isOver
                  ? "bg-rose-100 text-rose-400 cursor-not-allowed"
                  : "bg-slate-200 text-slate-400 cursor-not-allowed"
              }
            `}
          >
            {canSubmit
              ? "結果を見る →"
              : isOver
                ? `5人に絞ってください（現在${count}人）`
                : count === 0
                  ? "顧客を選んでください"
                  : `あと${MAX_SELECTION - count}人選んでください`
            }
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// コンポーネント: フリップ結果カード（Easyモード専用）
//
// 表面: 施策後の結果（顧客ID・名前・タイプ・点数）
// 裏面: 施策前の情報（顧客ID・名前・基本情報・ヒント）
//
// v1.1: 3Dフリップアニメーション
// v1.5: Easyモード限定ヒント
// v2.x: 表裏の役割を整理
//   表面 = 「施策後の結果」としてタイプ・点数のみ
//   裏面 = 「施策前に見えていた情報」として基本情報・ヒントをまとめる
// ─────────────────────────────────────────────

/** タイプ別の「ヒントとの対応」学習コメント */
const TYPE_HINT_COMMENT: Record<CustomerType, string> = {
  Persuadable:    "この顧客は施策によって行動が変化しやすい特徴を持っていました。",
  "Sure Thing":   "この顧客は施策がなくても購入する傾向がありました。",
  "Lost Cause":   "この顧客はどんな施策にも反応しにくい特徴がありました。",
  "Sleeping Dog": "この顧客は施策によって逆に購入しなくなる可能性がありました。",
};

function FlipResultCard({ customer, autoFlipDelay = 600, difficulty }:
  { customer: Customer; autoFlipDelay?: number; difficulty: Difficulty }) {
  const meta  = TYPE_META[customer.type];
  const score = TYPE_SCORE[customer.type];
  const showHint = difficulty === "easy" && !!customer.hint;

  // 初期状態は裏面（施策前の情報）→ autoFlip で表面（施策後=結果）へフリップ
  // これにより結果画面を開いた後、ドラマチックに結果が表示される演出になる
  const [faceVisible, setFaceVisible] = useState<"front" | "back">("back");
  const [rotating, setRotating] = useState(false);

  const execFlip = useCallback(() => {
    setRotating(true);
    setTimeout(() => {
      setFaceVisible(f => f === "front" ? "back" : "front");
      setTimeout(() => setRotating(false), 220);
    }, 220);
  }, []);

  useEffect(() => {
    if (autoFlipDelay < 0) return;
    const t = setTimeout(execFlip, autoFlipDelay);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const isFront = faceVisible === "front";

  return (
    <div
      className="cursor-pointer select-none rounded-2xl overflow-hidden"
      onClick={() => { if (!rotating) execFlip(); }}
      title="タップで反転"
      style={{
        perspective: "800px",
        transition: "transform 0.22s ease-in-out",
        transform: rotating
          ? `rotateY(${isFront ? "90deg" : "-90deg"})`
          : "rotateY(0deg)",
      }}
    >
      {isFront ? (
        /* ── 表面: 施策後の結果 ── */
        <div
          className={`rounded-2xl border-2 ${meta.border} p-3`}
          style={{ backgroundColor: meta.flipBg }}
        >
          {/* 顧客ID・名前 + 施策後バッジ */}
          <div className="flex items-center justify-between mb-2">
            <div>
              <span className="text-xs font-mono text-slate-400">{customer.id}</span>
              <div className="text-sm font-bold text-slate-700">{customer.name}</div>
            </div>
            <div className="text-xs text-slate-500 bg-white/60 rounded-full px-2 py-1">施策後</div>
          </div>

          {/* タイプバッジ */}
          <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full
              text-sm font-black ${meta.color} bg-white/70 mb-2`}>
            <span>{meta.emoji}</span><span>{meta.label}</span>
          </div>

          {/* 獲得点数（大きく中央寄せ） */}
          <div className="flex items-end justify-between">
            <p className={`text-xs leading-relaxed ${meta.color} max-w-[65%]`}>{meta.result}</p>
            <span className={`text-2xl font-black
              ${score > 0 ? "text-emerald-600" : score < 0 ? "text-rose-600" : "text-slate-400"}`}>
              {score > 0 ? `+${score}` : score}
              <span className="text-xs ml-0.5 font-normal">点</span>
            </span>
          </div>

          {/* フリップ促進テキスト */}
          <div className="flex items-center justify-center gap-1 text-slate-500 text-xs mt-2">
            <span>タップして施策前の情報を見る</span><span>↻</span>
          </div>
        </div>
      ) : (
        /* ── 裏面: 施策前に見えていた情報 ── */
        <div className="rounded-2xl border-2 border-slate-200 bg-white p-3">
          {/* 顧客ID・名前 + 施策前バッジ */}
          <div className="flex items-center justify-between mb-2">
            <div>
              <span className="text-xs font-mono text-slate-400">{customer.id}</span>
              <div className="text-sm font-bold text-slate-800">{customer.name}</div>
            </div>
            <div className="text-xs text-slate-400 bg-slate-100 rounded-full px-2 py-1">施策前</div>
          </div>

          {/* 基本情報グリッド（年齢・年収・購入回数） */}
          <div className="grid grid-cols-3 gap-1.5 mb-2">
            {[["年齢", `${customer.age}歳`], ["年収", `${customer.income}万円`], ["購入回数", `${customer.purchaseCount}回`]]
              .map(([label, value]) => (
                <div key={label} className="bg-slate-50 rounded-lg p-1.5 text-center">
                  <div className="text-xs text-slate-400">{label}</div>
                  <div className="text-xs font-bold text-slate-700">{value}</div>
                </div>
              ))}
          </div>

          {/* 行動傾向ヒント（裏面のみ・Easyモードのみ・選択画面と同じ内容） */}
          {showHint && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-2.5 mb-2">
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-amber-500 text-xs">💡</span>
                <span className="text-xs font-bold text-amber-700">行動傾向ヒント</span>
              </div>
              <p className="text-xs text-amber-800 leading-relaxed pl-1">{customer.hint}</p>
            </div>
          )}

          {/* フリップ促進テキスト */}
          <div className="flex items-center justify-center gap-1 text-slate-300 text-xs">
            <span>タップして結果に戻る</span><span>↻</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// 【v2.1b】Hardモード専用コンポーネント群
//
// generateAnalysisPoint — 実データ参照の分析ポイント文を動的生成
// HardAnalysisModal     — 分析レポートモーダル
// HardResultCard        — コンパクトな結果カード（フリップなし）
//
// Easy モードの FlipResultCard には一切変更を加えない。
// ─────────────────────────────────────────────

/**
 * 実際の顧客データを参照してタイプ別の分析ポイント文を動的生成する。
 * 固定文ではなく「この顧客固有の数値」を織り交ぜる。
 */
function generateAnalysisPoint(customer: Customer): { points: string[]; dsNote: string } {
  const hs = customer.hardStats;
  if (!hs) return { points: [], dsNote: "" };
  const { emailOpenRate, campaignViewsPerMonth, couponUsageCount,
          daysSinceLastPurchase, appUsagePerWeek, storeVisitsPerMonth } = hs;

  switch (customer.type) {
    case "Persuadable":
      return {
        points: [
          `メール開封率が${emailOpenRate}%と${emailOpenRate >= 65 ? "高く" : "やや低めですが"}、外部からの刺激に反応しやすい傾向があります。`,
          `キャンペーン閲覧が月${campaignViewsPerMonth}回と${campaignViewsPerMonth >= 4 ? "多く" : "一定数あり"}、情報収集はしているものの自然購入には至っていません。`,
          `クーポン利用は${couponUsageCount}回で、適切な施策があれば購入行動に変化が生じやすいタイプです。`,
        ],
        dsNote: "メール開封率・キャンペーン閲覧・クーポン利用の組み合わせに注目することで施策反応性の高さを見抜けます。これらが高いのに自然購入が少ない顧客が Persuadable の典型です。",
      };
    case "Sure Thing":
      return {
        points: [
          `最終購入が${daysSinceLastPurchase}日前と${daysSinceLastPurchase <= 20 ? "非常に最近で" : "比較的最近で"}、継続的に購入行動を示しています。`,
          `来店頻度が月${storeVisitsPerMonth}回、アプリ利用も週${appUsagePerWeek}回と積極的にブランドと関与し続けています。`,
          `クーポン利用は${couponUsageCount}回と少なく、割引がなくても購入する自発的な行動パターンが確認できます。`,
        ],
        dsNote: "最終購入日・来店頻度・クーポン利用回数の組み合わせが Sure Thing の識別に有効です。施策なしでも購入するため、クーポン配布はコスト増にしかなりません。",
      };
    case "Lost Cause":
      return {
        points: [
          `最終購入が${daysSinceLastPurchase}日前と${daysSinceLastPurchase >= 150 ? "かなり長期間経過しており" : "日数が経過しており"}、購買意欲の低下が読み取れます。`,
          `メール開封率が${emailOpenRate}%と${emailOpenRate <= 30 ? "非常に低く" : "低めで"}、情報接触そのものへの反応が薄い状態です。`,
          `アプリ利用も週${appUsagePerWeek}回とほとんどなく、ブランドとのエンゲージメント全体が低下しています。`,
        ],
        dsNote: "最終購入日・メール開封率・アプリ利用頻度の3つが揃って低い場合は Lost Cause の可能性が高いです。複数指標を組み合わせて判断することが重要で、1つの指標だけで決めつけないようにしましょう。",
      };
    case "Sleeping Dog":
      return {
        points: [
          `メール開封率が${emailOpenRate}%と${emailOpenRate >= 55 ? "比較的高く" : "一定あり"}、情報には接触していますが施策後の購入が減少する傾向があります。`,
          `キャンペーン閲覧が月${campaignViewsPerMonth}回と${campaignViewsPerMonth >= 4 ? "多め" : "一定数"}あるにもかかわらず、接触がネガティブな反応を引き起こしている可能性があります。`,
          `クーポン利用が${couponUsageCount}回と少なく、施策への露出そのものが購買意欲を下げているとも考えられます。`,
        ],
        dsNote: "Sleeping Dog は Persuadable と似た指標を持つため見分けにくい存在です。クーポン利用が低いのに閲覧率が高い場合、接触に対してネガティブな反応を示すリスクを疑いましょう。",
      };
  }
}

/** Hardモード専用: 分析レポートモーダル */
function HardAnalysisModal({
  customer,
  onClose,
}: {
  customer: Customer;
  onClose: () => void;
}) {
  const meta  = TYPE_META[customer.type];
  const score = TYPE_SCORE[customer.type];
  const { points, dsNote } = generateAnalysisPoint(customer);

  // フェードイン
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 10);
    return () => clearTimeout(t);
  }, []);

  // ESCキーで閉じる
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{
        backgroundColor: "rgba(0,0,0,0.5)",
        backdropFilter: "blur(4px)",
        transition: "opacity 0.25s",
        opacity: visible ? 1 : 0,
      }}
      onClick={onClose}
    >
      <div
        className="w-full bg-white rounded-3xl shadow-2xl overflow-hidden"
        style={{
          maxWidth: 480,
          transition: "opacity 0.25s, transform 0.25s",
          opacity: visible ? 1 : 0,
          transform: visible ? "scale(1)" : "scale(0.95)",
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── モーダルヘッダー ── */}
        <div
          className="px-5 pt-5 pb-4"
          style={{ background: "linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)" }}
        >
          <div className="flex items-start justify-between mb-3">
            <div>
              <div className="text-indigo-300 text-xs font-mono tracking-widest uppercase mb-1">
                Analysis Report
              </div>
              <div className="text-white font-black text-base">📊 顧客分析レポート</div>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center
                text-white/60 hover:bg-white/20 hover:text-white transition-colors shrink-0"
            >
              ✕
            </button>
          </div>
          {/* 顧客名 + タイプ + スコア */}
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs font-mono text-white/40">{customer.id}</span>
              <div className="text-white font-bold text-sm">{customer.name}</div>
            </div>
            <div className="flex items-center gap-2">
              <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full
                  text-xs font-black bg-white/20 text-white`}>
                <span>{meta.emoji}</span><span>{meta.label}</span>
              </div>
              <span className={`text-base font-black
                ${score > 0 ? "text-emerald-400" : score < 0 ? "text-rose-400" : "text-slate-400"}`}>
                {score > 0 ? `+${score}` : score}点
              </span>
            </div>
          </div>
        </div>

        {/* ── モーダルボディ（内部スクロール） ── */}
        <div className="overflow-y-auto px-5 py-4 space-y-4" style={{ maxHeight: "65vh" }}>

          {/* ゲーム選択画面と完全一致したカードUIを再利用（ID・名前はヘッダーで表示済みのため非表示） */}
          <div className="rounded-2xl border-2 border-slate-200 bg-white p-4">
            <CustomerCardPreview customer={customer} showHeader={false} />
          </div>

          {/* 区切り線 */}
          <div className="border-t border-slate-200" />

          {/* 分析ポイント */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-base">🧠</span>
              <span className="text-sm font-black text-slate-800">分析ポイント</span>
            </div>
            <div className="space-y-2">
              {points.map((pt, i) => (
                <div key={i} className="flex items-start gap-2">
                  <div className={`w-5 h-5 rounded-full shrink-0 flex items-center justify-center
                      text-white font-black mt-0.5 ${meta.dotClass}`}
                    style={{ fontSize: "9px" }}>
                    {i + 1}
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">{pt}</p>
                </div>
              ))}
            </div>
          </div>

          {/* データサイエンティスト視点 */}
          <div className="rounded-2xl bg-indigo-50 border border-indigo-200 p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-base">💡</span>
              <span className="text-xs font-black text-indigo-800 uppercase tracking-wider">
                データサイエンティスト視点
              </span>
            </div>
            <p className="text-xs text-indigo-700 leading-relaxed">{dsNote}</p>
          </div>
        </div>

        {/* ── フッター ── */}
        <div className="px-5 pb-5 pt-2 border-t border-slate-100">
          <button
            onClick={onClose}
            className="w-full py-3 rounded-2xl bg-slate-100 text-slate-600 font-bold text-sm
              hover:bg-slate-200 active:scale-[0.98] transition-all"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Hardモード専用: コンパクトな結果カード
 *
 * 表示内容: 顧客ID・名前・タイプ・結果コメント・スコア
 * 行動データはカード内に表示せず、「詳細分析を見る」ボタンでモーダルに委譲する。
 * FlipResultCard のフリップ演出は使用しない。
 */
function HardResultCard({ customer }: { customer: Customer }) {
  const meta  = TYPE_META[customer.type];
  const score = TYPE_SCORE[customer.type];
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <>
      <div
        className={`rounded-2xl border-2 ${meta.border} p-3`}
        style={{ backgroundColor: meta.flipBg }}
      >
        {/* ── 顧客ヘッダー ── */}
        <div className="flex items-start justify-between mb-2">
          <div>
            <span className="text-xs font-mono text-slate-400">{customer.id}</span>
            <div className="text-sm font-bold text-slate-800">{customer.name}</div>
          </div>
          {/* スコア */}
          <span className={`text-xl font-black
            ${score > 0 ? "text-emerald-600" : score < 0 ? "text-rose-600" : "text-slate-400"}`}>
            {score > 0 ? `+${score}` : score}
            <span className="text-xs ml-0.5 font-normal">点</span>
          </span>
        </div>

        {/* ── タイプバッジ ── */}
        <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full
            text-sm font-black ${meta.color} bg-white/70 mb-2`}>
          <span>{meta.emoji}</span>
          <span>{meta.label}</span>
        </div>

        {/* ── タイプ説明 ── */}
        <p className={`text-xs leading-relaxed ${meta.color} mb-2`}>{meta.result}</p>

        {/* ── 詳細分析ボタン ── */}
        <button
          onClick={() => setModalOpen(true)}
          className="w-full flex items-center justify-center gap-1.5 py-2 px-4 rounded-xl
            bg-white/60 border border-white/80 text-slate-600 text-xs font-bold
            hover:bg-white/90 active:scale-[0.98] transition-all"
        >
          <span>🔍</span>
          <span>詳細分析を見る</span>
        </button>
      </div>

      {/* 分析モーダル */}
      {modalOpen && (
        <HardAnalysisModal
          customer={customer}
          onClose={() => setModalOpen(false)}
        />
      )}
    </>
  );
}

// ─────────────────────────────────────────────
// 【NEW v1.8】コンポーネント: 理想顧客詳細モーダル
//
// 理想的な顧客TOP5の各行タップ時に表示する詳細パネル。
// 属性情報 → ヒント → 学習コメントの順で「なぜ理想顧客か」を解説。
// ─────────────────────────────────────────────

/** タイプ別の学習コメント（モーダル用・長めのバージョン） */
const TYPE_LEARN_COMMENT: Record<CustomerType, string> = {
  Persuadable:
    "この顧客は施策によって行動が変化しやすい特徴を持っています。\nアップリフトが高く、クーポン配布の効果が最大化できる理想的なターゲットです。",
  "Sure Thing":
    "この顧客は施策がなくても購入する可能性が高い顧客です。\nクーポンを送っても売上の純増にはつながりにくく、コストの無駄になる可能性があります。",
  "Lost Cause":
    "この顧客は施策への反応が弱く、購入につながりにくい特徴があります。\nどんなアプローチをしても行動変化が起きにくいため、リソース配分を見直す必要があります。",
  "Sleeping Dog":
    "この顧客には施策が逆効果になる可能性があります。\nクーポンや連絡をきっかけに離脱・拒否反応を示すタイプで、接触を避けることが得策です。",
};

function OptimalCustomerModal({
  customer,
  rank,
  wasSelected,
  onClose,
}: {
  customer: Customer;
  rank: number;
  wasSelected: boolean;
  onClose: () => void;
}) {
  const meta  = TYPE_META[customer.type];
  const score = TYPE_SCORE[customer.type];

  // ESCキーで閉じる
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    /* 背景オーバーレイ（クリックで閉じる） */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ backgroundColor: "rgba(0,0,0,0.45)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      {/* モーダル本体（クリックが親に伝播しないよう stopPropagation） */}
      <div
        className="w-full bg-white rounded-3xl shadow-2xl overflow-hidden"
        style={{ maxWidth: 420 }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── ヘッダー帯 ── */}
        <div
          className={`px-5 pt-5 pb-4 ${meta.bg} border-b-2 ${meta.border}`}
        >
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              {/* ランクバッジ */}
              <div className="w-8 h-8 rounded-full bg-white border-2 border-slate-200
                  flex items-center justify-center text-sm font-black text-slate-600 shrink-0">
                {rank}
              </div>
              <div>
                <div className="text-xs font-mono text-slate-400 mb-0.5">{customer.id}</div>
                <div className="text-lg font-black text-slate-800">{customer.name}</div>
              </div>
            </div>
            {/* ×ボタン */}
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-white/70 flex items-center justify-center
                text-slate-400 hover:text-slate-700 hover:bg-white transition-colors shrink-0 mt-0.5"
            >
              ✕
            </button>
          </div>

          {/* タイプバッジ + スコア */}
          <div className="flex items-center justify-between mt-3">
            <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full
                text-sm font-black bg-white/70 ${meta.color}`}>
              <span>{meta.emoji}</span>
              <span>{meta.label}</span>
            </div>
            <div className="flex items-center gap-2">
              {wasSelected && (
                <span className="text-xs bg-indigo-500 text-white px-2 py-1 rounded-full font-bold">
                  ✓ 選択済み
                </span>
              )}
              <span className={`text-lg font-black
                ${score > 0 ? "text-emerald-600" : score < 0 ? "text-rose-600" : "text-slate-400"}`}>
                {score > 0 ? `+${score}` : score}点
              </span>
            </div>
          </div>
        </div>

        {/* ── ボディ ── */}
        <div className="px-5 py-4 space-y-4 max-h-96 overflow-y-auto">

          {/*
           * 顧客選択画面と同一のカードUIを再利用（CustomerCardPreview）。
           * - Hardモード: 基本属性3列 + 行動データ6項目が選択画面と完全一致で表示される
           * - Easyモード: 基本属性3列のみ（hardStats が null のため行動データは非表示）
           * - 顧客ID・名前はヘッダーに表示済みのため showHeader={false}
           * - 「行動傾向ヒントセクション」は削除（Hardでは不要、Easyはヒントboxへ移動）
           */}
          <div className="rounded-2xl border-2 border-slate-200 bg-white p-4">
            <CustomerCardPreview customer={customer} showHeader={false} />
          </div>

          {/* Easy モードのみ: 行動傾向ヒント */}
          {customer.hint && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-amber-500">💡</span>
                <span className="text-xs font-bold text-amber-700 uppercase tracking-wider">行動傾向ヒント</span>
              </div>
              <p className="text-sm text-amber-800 leading-relaxed">{customer.hint}</p>
            </div>
          )}

          {/* 学習コメント → 分析ポイント（結果画面・HardAnalysisModal と同一デザイン） */}
          {(() => {
            const { points, dsNote } = generateAnalysisPoint(customer);
            // hardStats がない（Easyモード）場合は TYPE_LEARN_COMMENT にフォールバック
            if (points.length === 0) {
              return (
                <div className={`rounded-2xl p-4 border ${meta.bg} ${meta.border}`}>
                  <div className={`flex items-center gap-2 mb-2 ${meta.color}`}>
                    <span className="text-sm">{meta.emoji}</span>
                    <span className="text-xs font-bold uppercase tracking-wider">なぜ理想顧客？</span>
                  </div>
                  <p className={`text-sm leading-relaxed whitespace-pre-line ${meta.color}`}>
                    {TYPE_LEARN_COMMENT[customer.type]}
                  </p>
                </div>
              );
            }
            return (
              <>
                {/* 🧠 分析ポイント */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-base">🧠</span>
                    <span className="text-sm font-black text-slate-800">分析ポイント</span>
                  </div>
                  <div className="space-y-2">
                    {points.map((pt, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <div className={`w-5 h-5 rounded-full shrink-0 flex items-center justify-center
                            text-white font-black mt-0.5 ${meta.dotClass}`}
                          style={{ fontSize: "9px" }}>
                          {i + 1}
                        </div>
                        <p className="text-xs text-slate-600 leading-relaxed">{pt}</p>
                      </div>
                    ))}
                  </div>
                </div>
                {/* 💡 データサイエンティスト視点 */}
                <div className="rounded-2xl bg-indigo-50 border border-indigo-200 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-base">💡</span>
                    <span className="text-xs font-black text-indigo-800 uppercase tracking-wider">
                      データサイエンティスト視点
                    </span>
                  </div>
                  <p className="text-xs text-indigo-700 leading-relaxed">{dsNote}</p>
                </div>
              </>
            );
          })()}
        </div>

        {/* ── フッター ── */}
        <div className="px-5 pb-5">
          <button
            onClick={onClose}
            className="w-full py-3 rounded-2xl bg-slate-100 text-slate-600 font-bold text-sm
              hover:bg-slate-200 active:scale-[0.98] transition-all"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// 【v1.2 / v1.8更新】コンポーネント: 理想解パネル
//
// v1.2: 達成率メーター / 理想顧客一覧 / 比較サマリー
// v1.8: 理想顧客カードをタップ可能に → OptimalCustomerModal で詳細表示
// ─────────────────────────────────────────────
function OptimalPanel({
  allCustomers,
  selectedCustomers,
}: {
  allCustomers: Customer[];
  selectedCustomers: Customer[];
}) {
  const [open, setOpen] = useState(false);
  // v1.8: 詳細モーダル用 state
  const [detailCustomer, setDetailCustomer] = useState<Customer | null>(null);
  const [detailRank,     setDetailRank]     = useState<number>(1);

  // 最適選択とスコア計算
  const optimal     = useMemo(() => computeOptimalSelection(allCustomers), [allCustomers]);
  const maxScore    = optimal.reduce((s, c) => s + TYPE_SCORE[c.type], 0);
  const playerScore = selectedCustomers.reduce((s, c) => s + TYPE_SCORE[c.type], 0);
  const achievePct  = maxScore <= 0 ? 100 : Math.max(0, Math.round((playerScore / maxScore) * 100));

  const selectedIdSet = new Set(selectedCustomers.map(c => c.id));

  const meterColor = achievePct >= 80 ? "#10b981" : achievePct >= 50 ? "#f59e0b" : "#f43f5e";
  const R   = 44;
  const CIR = 2 * Math.PI * R;
  const offset = CIR * (1 - achievePct / 100);

  return (
    <>
      <div className="rounded-3xl overflow-hidden border border-slate-200 shadow-sm bg-white">
        {/* ヘッダー（タップで開閉） */}
        <button
          onClick={() => setOpen(o => !o)}
          className="w-full text-left px-5 py-4 flex items-center justify-between
            bg-gradient-to-r from-violet-600 to-indigo-600 transition-opacity active:opacity-80"
        >
          <div>
            <div className="text-xs font-mono text-white/60 mb-0.5 tracking-widest uppercase">Optimal Solution</div>
            <div className="text-white font-black text-base">理想解・達成率を見る</div>
          </div>
          <span className="text-white/80 text-xl transition-transform duration-200"
            style={{ display: "inline-block", transform: open ? "rotate(180deg)" : "rotate(0deg)" }}>
            ▼
          </span>
        </button>

        {open && (
          <div className="p-5 space-y-6">

            {/* 達成率メーター */}
            <div className="flex items-center gap-6">
              <div className="relative shrink-0" style={{ width: 100, height: 100 }}>
                <svg width="100" height="100" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r={R} fill="none" stroke="#e2e8f0" strokeWidth="10" />
                  <circle cx="50" cy="50" r={R} fill="none"
                    stroke={meterColor} strokeWidth="10" strokeLinecap="round"
                    strokeDasharray={CIR} strokeDashoffset={offset}
                    style={{ transform: "rotate(-90deg)", transformOrigin: "50% 50%",
                      transition: "stroke-dashoffset 1s ease-out" }}
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-2xl font-black" style={{ color: meterColor }}>{achievePct}%</span>
                </div>
              </div>
              <div className="flex-1 space-y-3">
                {[
                  { label: "理論上の最高スコア", value: maxScore, highlight: false },
                  { label: "あなたのスコア",     value: playerScore, highlight: true },
                ].map(({ label, value, highlight }) => (
                  <div key={label}>
                    <div className="text-xs text-slate-500 mb-0.5">{label}</div>
                    <div className={`text-2xl font-black
                      ${highlight ? value >= 0 ? "text-indigo-600" : "text-rose-600" : "text-slate-700"}`}>
                      {value > 0 ? `+${value}` : value}
                      <span className="text-sm font-normal text-slate-400 ml-1">点</span>
                    </div>
                  </div>
                ))}
                {maxScore !== playerScore && (
                  <div className="text-xs text-slate-400 font-mono">
                    差分: {playerScore - maxScore >= 0 ? "+" : ""}{playerScore - maxScore}点
                  </div>
                )}
              </div>
            </div>

            {/* 達成率コメント */}
            <div className={`rounded-2xl p-3 text-sm font-semibold text-center
              ${achievePct >= 80 ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                : achievePct >= 50 ? "bg-amber-50 text-amber-700 border border-amber-200"
                : "bg-rose-50 text-rose-700 border border-rose-200"}`}>
              {achievePct >= 100 ? "🏆 完璧！理想的な選択ができました！"
                : achievePct >= 80 ? "🎉 素晴らしい！最適解に近い選択です"
                : achievePct >= 50 ? "📈 まずまずです。次は Persuadable に注目してみましょう"
                : "💡 Persuadable（施策で行動が変わる顧客）を優先して選びましょう"}
            </div>

            {/* ── 理想的な顧客一覧（v1.8: タップ可能に変更） ── */}
            <div>
              <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">
                理想的な顧客TOP{MAX_SELECTION}
              </div>
              {/* v1.8: タップで詳細モーダルが開く旨をガイド */}
              <p className="text-xs text-slate-400 mb-3">
                タップして詳細・学習コメントを確認できます
              </p>
              <div className="space-y-2">
                {optimal.map((c, idx) => {
                  const rank        = idx + 1;
                  const m           = TYPE_META[c.type];
                  const s           = TYPE_SCORE[c.type];
                  const wasSelected = selectedIdSet.has(c.id);
                  const isOpen      = detailCustomer?.id === c.id;
                  return (
                    <button
                      key={c.id}
                      onClick={() => {
                        setDetailCustomer(c);
                        setDetailRank(rank);
                      }}
                      className={`
                        w-full text-left flex items-center gap-3 rounded-xl px-4 py-3 border
                        transition-all duration-150 active:scale-[0.98]
                        ${isOpen
                          ? "border-violet-400 bg-violet-50 ring-2 ring-violet-300"
                          : wasSelected
                            ? "border-indigo-300 bg-indigo-50 hover:border-indigo-400"
                            : `${m.border} ${m.bg} hover:opacity-80`
                        }
                      `}
                    >
                      {/* ランク */}
                      <div className="w-6 h-6 rounded-full bg-white border border-slate-200
                          flex items-center justify-center text-xs font-black text-slate-500 shrink-0">
                        {rank}
                      </div>
                      {/* タイプドット */}
                      <div className={`w-3 h-3 rounded-full shrink-0 ${m.dotClass}`} />
                      {/* 顧客情報 */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-mono text-slate-400">{c.id}</span>
                          <span className="text-sm font-bold text-slate-700">{c.name}</span>
                          {wasSelected && (
                            <span className="text-xs bg-indigo-500 text-white px-2 py-0.5 rounded-full font-bold">
                              ✓ 選択済み
                            </span>
                          )}
                        </div>
                        <div className={`text-xs mt-0.5 font-semibold ${m.color}`}>
                          {m.emoji} {m.label}
                        </div>
                      </div>
                      {/* スコア + 詳細矢印 */}
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`text-base font-black
                          ${s > 0 ? "text-emerald-600" : s < 0 ? "text-rose-600" : "text-slate-400"}`}>
                          {s > 0 ? `+${s}` : s}
                        </span>
                        <span className="text-slate-300 text-sm">›</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 自分の選択との比較サマリー */}
            <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200">
              <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
                あなたの選択 vs 理想解
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs text-slate-400 mb-2">あなた</div>
                  {(["Persuadable","Sure Thing","Lost Cause","Sleeping Dog"] as CustomerType[]).map(type => {
                    const cnt = selectedCustomers.filter(c => c.type === type).length;
                    if (cnt === 0) return null;
                    const m = TYPE_META[type];
                    return (
                      <div key={type} className="flex items-center gap-1.5 mb-1">
                        <div className={`w-2 h-2 rounded-full shrink-0 ${m.dotClass}`} />
                        <span className="text-xs text-slate-600">{m.label}</span>
                        <span className="text-xs font-bold text-slate-800 ml-auto">{cnt}人</span>
                      </div>
                    );
                  })}
                </div>
                <div>
                  <div className="text-xs text-slate-400 mb-2">理想</div>
                  {(["Persuadable","Sure Thing","Lost Cause","Sleeping Dog"] as CustomerType[]).map(type => {
                    const cnt = optimal.filter(c => c.type === type).length;
                    if (cnt === 0) return null;
                    const m = TYPE_META[type];
                    return (
                      <div key={type} className="flex items-center gap-1.5 mb-1">
                        <div className={`w-2 h-2 rounded-full shrink-0 ${m.dotClass}`} />
                        <span className="text-xs text-slate-600">{m.label}</span>
                        <span className="text-xs font-bold text-slate-800 ml-auto">{cnt}人</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* v1.8: 詳細モーダル（OptimalPanel の外に portal 的に表示） */}
      {detailCustomer && (
        <OptimalCustomerModal
          customer={detailCustomer}
          rank={detailRank}
          wasSelected={selectedIdSet.has(detailCustomer.id)}
          onClose={() => setDetailCustomer(null)}
        />
      )}
    </>
  );
}

// ─────────────────────────────────────────────
// 【v1.2 / v1.9更新】コンポーネント: 全顧客答え合わせ
//
// v1.2: タイプフィルタ / 選択ハイライト / テーブル形式
// v1.9: UI刷新
//   - 一覧は「ID / 名前 / タイプ」の3列のみ（情報を減らして俯瞰しやすく）
//   - 行タップで詳細モーダルを表示（属性・ヒント・タイプ解説）
//   - モーダルは opacity+scale アニメーション付き
// ─────────────────────────────────────────────

/** 全顧客答え合わせ用の顧客詳細モーダル */
function CustomerDetailModal({
  customer,
  isMyPick,
  onClose,
}: {
  customer: Customer;
  isMyPick: boolean;
  onClose: () => void;
}) {
  const meta  = TYPE_META[customer.type];
  const score = TYPE_SCORE[customer.type];

  // mount 直後に visible=true にしてトランジションを発火
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 10);
    return () => clearTimeout(t);
  }, []);

  // ESCキーで閉じる
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    /* 背景オーバーレイ */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{
        backgroundColor: "rgba(0,0,0,0.45)",
        backdropFilter: "blur(4px)",
        transition: "opacity 0.25s ease-out",
        opacity: visible ? 1 : 0,
      }}
      onClick={onClose}
    >
      {/* モーダル本体 */}
      <div
        className="w-full bg-white rounded-3xl shadow-2xl overflow-hidden"
        style={{
          maxWidth: 440,
          transition: "opacity 0.25s ease-out, transform 0.25s ease-out",
          opacity:   visible ? 1 : 0,
          transform: visible ? "scale(1)" : "scale(0.95)",
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── ヘッダー帯 ── */}
        <div className={`px-5 pt-5 pb-4 ${meta.bg} border-b-2 ${meta.border}`}>
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              {/* タイプカラーのドット */}
              <div className={`w-3 h-3 rounded-full shrink-0 mt-1 ${meta.dotClass}`} />
              <div>
                <div className="text-xs font-mono text-slate-400 mb-0.5">{customer.id}</div>
                <div className="text-lg font-black text-slate-800 leading-tight">{customer.name}</div>
              </div>
            </div>
            {/* ×ボタン */}
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-white/70 flex items-center justify-center
                text-slate-400 hover:text-slate-700 hover:bg-white transition-colors shrink-0 mt-0.5"
            >
              ✕
            </button>
          </div>

          {/* タイプバッジ + スコア + 選択済みバッジ */}
          <div className="flex items-center justify-between mt-3 flex-wrap gap-2">
            <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full
                text-sm font-black bg-white/70 ${meta.color}`}>
              <span>{meta.emoji}</span>
              <span>{meta.label}</span>
            </div>
            <div className="flex items-center gap-2">
              {isMyPick && (
                <span className="text-xs bg-indigo-500 text-white px-2 py-1 rounded-full font-bold">
                  ✓ あなたの選択
                </span>
              )}
              <span className={`text-lg font-black
                ${score > 0 ? "text-emerald-600" : score < 0 ? "text-rose-600" : "text-slate-400"}`}>
                {score > 0 ? `+${score}` : score}点
              </span>
            </div>
          </div>
        </div>

        {/* ── ボディ（内部スクロール対応） ── */}
        <div className="px-5 py-4 space-y-4 overflow-y-auto" style={{ maxHeight: "60vh" }}>

          {/*
           * 顧客選択画面と同一のカードUIを再利用（CustomerCardPreview）。
           * - Hard: 基本属性3列 + 行動データ6項目（選択画面と完全一致）
           * - Easy: 基本属性3列のみ（hardStats が null のため行動データは非表示）
           * - ID・名前はヘッダーに表示済みのため showHeader={false}
           * - 「行動傾向ヒント」セクションは削除（Hardでは不要）
           */}
          <div className="rounded-2xl border-2 border-slate-200 bg-white p-4">
            <CustomerCardPreview customer={customer} showHeader={false} />
          </div>

          {/* Easy モードのみ: 行動傾向ヒント */}
          {customer.hint && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-amber-500">💡</span>
                <span className="text-xs font-bold text-amber-700 uppercase tracking-wider">行動傾向ヒント</span>
              </div>
              <p className="text-sm text-amber-800 leading-relaxed">{customer.hint}</p>
            </div>
          )}

          {/* タイプ解説（現状維持） */}
          <div className={`rounded-2xl p-4 border ${meta.bg} ${meta.border}`}>
            <div className={`flex items-center gap-2 mb-2 ${meta.color}`}>
              <span>{meta.emoji}</span>
              <span className="text-xs font-bold uppercase tracking-wider">タイプ解説</span>
            </div>
            <p className={`text-sm leading-relaxed ${meta.color}`}>{meta.result}</p>
            {/* タイプ別学習コメント（TYPE_LEARN_COMMENT を再利用） */}
            <p className={`text-xs leading-relaxed mt-2 pt-2 border-t border-current/20 ${meta.color} opacity-80`}>
              {TYPE_LEARN_COMMENT[customer.type]}
            </p>
          </div>
        </div>

        {/* ── フッター ── */}
        <div className="px-5 pb-5 pt-2">
          <button
            onClick={onClose}
            className="w-full py-3 rounded-2xl bg-slate-100 text-slate-600 font-bold text-sm
              hover:bg-slate-200 active:scale-[0.98] transition-all"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}

function AllCustomersReview({
  allCustomers,
  selectedCustomers,
}: {
  allCustomers: Customer[];
  selectedCustomers: Customer[];
}) {
  const [open,           setOpen]           = useState(false);
  const [filter,         setFilter]         = useState<TypeFilter>("all");
  // v1.9: 詳細モーダル
  const [detailCustomer, setDetailCustomer] = useState<Customer | null>(null);

  const selectedIdSet = new Set(selectedCustomers.map(c => c.id));

  const filtered = useMemo(
    () => filter === "all" ? allCustomers : allCustomers.filter(c => c.type === filter),
    [allCustomers, filter]
  );

  const counts = useMemo(() => {
    const map: Partial<Record<TypeFilter, number>> = { all: allCustomers.length };
    (["Persuadable","Sure Thing","Lost Cause","Sleeping Dog"] as CustomerType[]).forEach(t => {
      map[t] = allCustomers.filter(c => c.type === t).length;
    });
    return map;
  }, [allCustomers]);

  const tabs: { key: TypeFilter; label: string; dotClass?: string }[] = [
    { key: "all",          label: "全員" },
    { key: "Persuadable",  label: "🎯",   dotClass: "bg-emerald-500" },
    { key: "Sure Thing",   label: "✅",   dotClass: "bg-sky-500" },
    { key: "Lost Cause",   label: "😶",   dotClass: "bg-slate-400" },
    { key: "Sleeping Dog", label: "⚠️",  dotClass: "bg-rose-500" },
  ];

  return (
    <>
      <div className="rounded-3xl overflow-hidden border border-slate-200 shadow-sm bg-white">
        {/* セクションヘッダー */}
        <button
          onClick={() => setOpen(o => !o)}
          className="w-full text-left px-5 py-4 flex items-center justify-between
            bg-gradient-to-r from-slate-700 to-slate-800 transition-opacity active:opacity-80"
        >
          <div>
            <div className="text-xs font-mono text-white/50 mb-0.5 tracking-widest uppercase">Answer Key</div>
            <div className="text-white font-black text-base">全顧客の答え合わせ</div>
            <div className="text-white/50 text-xs mt-0.5">タップして各顧客の詳細を確認</div>
          </div>
          <span className="text-white/70 text-xl"
            style={{ display: "inline-block", transition: "transform 0.2s",
              transform: open ? "rotate(180deg)" : "rotate(0deg)" }}>
            ▼
          </span>
        </button>

        {open && (
          <div className="p-4">
            {/* タイプフィルタタブ */}
            <div className="flex gap-1.5 mb-4 flex-wrap">
              {tabs.map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setFilter(tab.key)}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-bold transition-all
                    ${filter === tab.key
                      ? "bg-slate-800 text-white shadow-sm"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                >
                  {tab.dotClass && <span className={`w-2 h-2 rounded-full ${tab.dotClass}`} />}
                  {tab.label}
                  <span className={`ml-0.5 ${filter === tab.key ? "text-white/70" : "text-slate-400"}`}>
                    {counts[tab.key]}
                  </span>
                </button>
              ))}
            </div>

            {/* ── v1.9: スリム一覧（ID / 名前 / タイプのみ） ── */}
            <div className="rounded-2xl border border-slate-200 overflow-hidden">
              {/* 列ヘッダー */}
              <div className="grid bg-slate-100 px-4 py-2 text-xs font-bold text-slate-500 uppercase tracking-wider"
                style={{ gridTemplateColumns: "2.8rem 1fr auto 1.5rem" }}>
                <span>ID</span>
                <span>名前</span>
                <span className="text-right pr-2">タイプ</span>
                <span />
              </div>

              {/* データ行 */}
              <div className="divide-y divide-slate-100">
                {filtered.map(c => {
                  const m        = TYPE_META[c.type];
                  const isMyPick = selectedIdSet.has(c.id);
                  return (
                    <button
                      key={c.id}
                      onClick={() => setDetailCustomer(c)}
                      className={`
                        w-full text-left grid items-center px-4 py-3
                        transition-colors duration-100 active:scale-[0.99]
                        ${isMyPick
                          ? "bg-indigo-50 border-l-4 border-indigo-400 hover:bg-indigo-100"
                          : "bg-white border-l-4 border-transparent hover:bg-slate-50"
                        }
                      `}
                      style={{ gridTemplateColumns: "2.8rem 1fr auto 1.5rem" }}
                    >
                      {/* ID */}
                      <span className="font-mono text-xs text-slate-400">{c.id}</span>

                      {/* 名前 + 選択バッジ */}
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-sm font-semibold text-slate-700 truncate">{c.name}</span>
                        {isMyPick && (
                          <span className="shrink-0 w-4 h-4 rounded-full bg-indigo-500
                              flex items-center justify-center text-white font-black"
                            style={{ fontSize: "9px" }}>
                            ✓
                          </span>
                        )}
                      </div>

                      {/* タイプバッジ */}
                      <div className="flex items-center gap-1.5 pr-2">
                        <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${m.dotClass}`} />
                        <span className={`text-xs font-bold ${m.color}`}>{m.emoji} {m.label}</span>
                      </div>

                      {/* Chevron */}
                      <span className="text-slate-300 text-base">›</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 凡例 */}
            <div className="mt-4 grid grid-cols-2 gap-2">
              {(["Persuadable","Sure Thing","Lost Cause","Sleeping Dog"] as CustomerType[]).map(type => {
                const m = TYPE_META[type];
                const s = TYPE_SCORE[type];
                return (
                  <div key={type} className={`rounded-xl p-2.5 border ${m.bg} ${m.border} flex items-center justify-between`}>
                    <div className="flex items-center gap-1.5">
                      <div className={`w-2.5 h-2.5 rounded-full ${m.dotClass}`} />
                      <span className={`text-xs font-bold ${m.color}`}>{m.label}</span>
                    </div>
                    <span className={`text-xs font-black
                      ${s > 0 ? "text-emerald-600" : s < 0 ? "text-rose-600" : "text-slate-400"}`}>
                      {s > 0 ? `+${s}` : s}点
                    </span>
                  </div>
                );
              })}
            </div>

            {/* 凡例: 選択済みライン説明 */}
            <div className="mt-3 flex items-center gap-2 text-xs text-slate-400">
              <div className="w-4 h-4 border-l-4 border-indigo-400" />
              <span>青いラインはあなたが選んだ顧客</span>
            </div>
          </div>
        )}
      </div>

      {/* v1.9: 詳細モーダル */}
      {detailCustomer && (
        <CustomerDetailModal
          customer={detailCustomer}
          isMyPick={selectedIdSet.has(detailCustomer.id)}
          onClose={() => setDetailCustomer(null)}
        />
      )}
    </>
  );
}

// ─────────────────────────────────────────────
// コンポーネント: 解説セクション（v1.0 から継続）
// ─────────────────────────────────────────────
function ExplanationSection() {
  return (
    <div className="mt-4 rounded-3xl overflow-hidden border border-slate-200 shadow-sm">
      <div className="bg-gradient-to-r from-indigo-600 to-violet-600 p-6 text-white">
        <div className="text-xs font-mono opacity-70 mb-1">LEARN MORE</div>
        <h2 className="text-xl font-black mb-1">アップリフトモデリングとは？</h2>
        <p className="text-sm opacity-80">なぜ「買いそうな人」を選ぶだけではダメなのか</p>
      </div>
      <div className="bg-white p-6 space-y-6">
        <div>
          <h3 className="font-bold text-slate-800 mb-2">🤔 従来のアプローチの問題点</h3>
          <p className="text-sm text-slate-600 leading-relaxed">
            多くのマーケターは「購入確率の高い顧客」にクーポンを送ります。しかし、
            もともと買う予定だった人（Sure Thing）にクーポンを送っても売上は増えません。
            むしろクーポン分だけコストが増えるだけです。
          </p>
        </div>
        <div>
          <h3 className="font-bold text-slate-800 mb-3">📊 4つの顧客タイプ</h3>
          <div className="grid grid-cols-2 gap-2">
            {(Object.entries(TYPE_META) as [CustomerType, typeof TYPE_META[CustomerType]][]).map(([type, m]) => (
              <div key={type} className={`rounded-xl p-3 border ${m.bg} ${m.border}`}>
                <div className={`font-bold mb-1 text-xs ${m.color}`}>{m.emoji} {m.label}</div>
                <div className="text-slate-600 text-xs">
                  {type === "Persuadable"  && "施策あり→購入 / 施策なし→未購入"}
                  {type === "Sure Thing"   && "施策あり→購入 / 施策なし→購入"}
                  {type === "Lost Cause"   && "施策あり→未購入 / 施策なし→未購入"}
                  {type === "Sleeping Dog" && "施策あり→未購入 / 施策なし→購入（逆効果）"}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div>
          <h3 className="font-bold text-slate-800 mb-2">🎯 Persuadableが最重要な理由</h3>
          <p className="text-sm text-slate-600 leading-relaxed">
            アップリフトモデリングの目標は
            <strong className="text-indigo-700">施策によって行動が変わる顧客（Persuadable）</strong>
            だけを見つけることです。購入確率が低くても、施策があれば買ってくれる人を見つけることが本当の価値です。
          </p>
        </div>
        <div>
          <h3 className="font-bold text-slate-800 mb-2">📈 アップリフトの考え方</h3>
          <div className="bg-slate-50 rounded-xl p-4 font-mono text-sm border border-slate-200">
            <p className="text-slate-600 text-xs mb-1">アップリフト =</p>
            <p className="text-indigo-700 font-bold">P(購入 | 施策あり) − P(購入 | 施策なし)</p>
          </div>
          <p className="text-sm text-slate-600 leading-relaxed mt-3">
            この「差分」が大きいほど施策効果の高い顧客です。
            購入確率そのものではなく<strong>施策による変化量</strong>を予測するのがアップリフトモデリングです。
          </p>
        </div>
        <div className="bg-indigo-50 rounded-2xl p-4 border border-indigo-100">
          <p className="text-sm text-indigo-800 font-semibold text-center">
            💡「誰が買うか」ではなく「誰が施策で変わるか」を予測する——<br />
            それがアップリフトモデリングの本質です
          </p>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// コンポーネント: 結果画面
// v1.2: allCustomers 追加
// v1.7: マウント時に先頭へ自動スクロール（モーダル経由で開いた際のスクロール位置ずれを修正）
// ─────────────────────────────────────────────
function ResultScreen({
  selectedCustomers,
  allCustomers,
  difficulty,
  onRestart,
}: {
  selectedCustomers: Customer[];
  allCustomers: Customer[];
  difficulty: Difficulty;
  onRestart: () => void;
}) {
  const totalScore = selectedCustomers.reduce((s, c) => s + TYPE_SCORE[c.type], 0);
  const comment    = getEvaluationComment(selectedCustomers);
  const [isNewBest, setIsNewBest] = useState(false);
  const [bestScore, setBestScore] = useState<number | null>(null);

  // v1.7: 画面先頭へのスクロール用 ref
  const topRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const updated = saveBestScore(difficulty, totalScore);
    setIsNewBest(updated);
    setBestScore(loadBestScore(difficulty));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // v1.7: マウント後 150ms 待ってから先頭へスムーズスクロール
  // （モーダルのフェードアウトアニメーションが終わるのを待つ）
  useEffect(() => {
    const t = setTimeout(() => {
      topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 150);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="min-h-screen bg-slate-50">
      {/* v1.7: スクロールアンカー — このdivが画面最上部に来るようにスクロールする */}
      <div ref={topRef} />
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="rounded-3xl overflow-hidden mb-6 shadow-md"
          style={{ background: "linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)" }}>
          <div className="p-6 text-center text-white">
            <div className="text-xs font-mono opacity-60 mb-1 tracking-widest uppercase">Result</div>
            {isNewBest && (
              <div className="inline-flex items-center gap-1.5 bg-yellow-400 text-yellow-900
                  text-xs font-black px-3 py-1 rounded-full mb-3 animate-bounce">
                🏆 NEW BEST!
              </div>
            )}
            <div className="text-6xl font-black mb-1">
              {totalScore > 0 ? "+" : ""}{totalScore}
              <span className="text-2xl ml-1 opacity-70">点</span>
            </div>
            {bestScore !== null && !isNewBest && (
              <div className="text-xs opacity-50 mb-2 font-mono">
                ベスト: {bestScore}点{totalScore < bestScore && ` (あと ${bestScore - totalScore}点)`}
              </div>
            )}
            <p className="text-sm opacity-80 leading-relaxed">{comment}</p>
          </div>
          <div className="grid grid-cols-4 divide-x divide-white/10 bg-white/10">
            {(["Persuadable","Sure Thing","Lost Cause","Sleeping Dog"] as CustomerType[]).map(type => {
              const count = selectedCustomers.filter(c => c.type === type).length;
              const short = { Persuadable:"P","Sure Thing":"ST","Lost Cause":"LC","Sleeping Dog":"SD" }[type];
              return (
                <div key={type} className="py-3 text-center">
                  <div className="text-white font-black text-xl">{count}</div>
                  <div className="text-white/50 text-xs">{short}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── フリップカード / Hardカード ── */}
        <div className="mb-2">
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">選択した顧客の結果</h2>
          <p className="text-xs text-slate-400 mb-4">
            {difficulty === "easy"
              ? <>カードをタップして施策前 → 施策後を確認
                  {" "}<span className="text-amber-600 font-semibold">💡 ヒントとタイプの関係も確認できます</span>
                </>
              : "各カードの「詳細分析を見る」で行動データと分析ポイントを確認できます"
            }
          </p>
        </div>
        <div className="space-y-2 mb-6">
          {selectedCustomers.map((c, i) =>
            difficulty === "hard"
              ? <HardResultCard key={c.id} customer={c} />
              : <FlipResultCard key={c.id} customer={c} autoFlipDelay={400 + i * 300} difficulty={difficulty} />
          )}
        </div>

        {/* ── スコア凡例 ── */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 mb-4">
          <div className="text-xs font-bold text-slate-500 mb-3 uppercase tracking-wider">スコア基準</div>
          <div className="space-y-2">
            {(Object.entries(TYPE_SCORE) as [CustomerType, number][]).map(([type, score]) => (
              <div key={type} className="flex justify-between items-center text-sm">
                <span className="text-slate-600">{TYPE_META[type].emoji} {TYPE_META[type].label}</span>
                <span className={`font-bold ${score > 0 ? "text-emerald-600" : score < 0 ? "text-rose-600" : "text-slate-400"}`}>
                  {score > 0 ? `+${score}` : score}点
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* ── 【NEW】理想解パネル ── */}
        <OptimalPanel allCustomers={allCustomers} selectedCustomers={selectedCustomers} />

        {/* ── 【NEW】全顧客答え合わせ ── */}
        <div className="mt-4">
          <AllCustomersReview allCustomers={allCustomers} selectedCustomers={selectedCustomers} />
        </div>

        {/* ── 解説セクション ── */}
        <ExplanationSection />

        {/* ── もう一度ボタン ── */}
        <button onClick={onRestart}
          className="w-full mt-8 py-4 rounded-2xl font-black text-base bg-indigo-600 text-white
            active:scale-[0.98] shadow-md shadow-indigo-200 transition-all">
          もう一度プレイ
        </button>
        <div className="h-8" />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// 【NEW v1.6】コンポーネント: ResultRevealModal
//
// 「結果を見る」押下後に表示する結果発表オーバーレイ。
// 演出シーケンス:
//   Phase 0 — カード出現 + 「分析中...」ドットループ  (0〜1.1s)
//   Phase 1 — スコアへ切替 + カウントアップ           (1.1〜2.9s)
//   Phase 2 — コメントフェードイン                   (2.9〜3.3s)
//   Phase 3 — 「詳細を見る」ボタンフェードイン        (3.3s〜)
// ─────────────────────────────────────────────

/** モーダル用の短い2行コメントを生成（既存 getEvaluationComment とは別） */
function getRevealComment(customers: Customer[]): { headline: string; body: string } {
  const p  = customers.filter(c => c.type === "Persuadable").length;
  const st = customers.filter(c => c.type === "Sure Thing").length;
  const sd = customers.filter(c => c.type === "Sleeping Dog").length;
  const score = customers.reduce((s, c) => s + TYPE_SCORE[c.type], 0);

  if (sd >= 2) return {
    headline: "改善の余地があります",
    body: "施策が逆効果になる顧客が含まれていました。\nSleeping Dogに注意してみましょう。",
  };
  if (p >= 3) return {
    headline: "素晴らしい結果です！",
    body: `施策によって行動が変わる顧客を\n${p}人発見できました。`,
  };
  if (st >= 3) return {
    headline: "惜しい結果です",
    body: "購入しそうな顧客を多く選びましたが、\n施策効果は限定的でした。",
  };
  if (score >= 200) return {
    headline: "なかなか良い結果です！",
    body: "一部の顧客に対して効果的な\n施策を実施できました。",
  };
  return {
    headline: "改善の余地があります",
    body: "購入しそうな顧客と施策で行動が変わる顧客は\n異なります。次回はヒントに注目しましょう。",
  };
}

type RevealPhase = 0 | 1 | 2 | 3;

interface ResultRevealModalProps {
  selectedCustomers: Customer[];
  onClose: () => void; // 「詳細を見る」押下 → 結果画面へ
}

function ResultRevealModal({ selectedCustomers, onClose }: ResultRevealModalProps) {
  const totalScore = selectedCustomers.reduce((s, c) => s + TYPE_SCORE[c.type], 0);
  const { headline, body } = getRevealComment(selectedCustomers);

  // ── アニメーション state ──
  const [cardVisible,   setCardVisible]   = useState(false); // カード出現
  const [phase,         setPhase]         = useState<RevealPhase>(0);
  const [dotCount,      setDotCount]      = useState(1);     // 「分析中.」のドット数
  const [displayScore,  setDisplayScore]  = useState(0);     // カウントアップ中の表示値

  // ── Phase タイマー ──
  useEffect(() => {
    // カード出現（マウント直後に少し遅らせてトランジションを確実に発火）
    const t0 = setTimeout(() => setCardVisible(true), 30);

    // Phase 1: スコア表示へ切替
    const t1 = setTimeout(() => setPhase(1), 1100);
    // Phase 2: コメント表示
    const t2 = setTimeout(() => setPhase(2), 2900);
    // Phase 3: ボタン表示
    const t3 = setTimeout(() => setPhase(3), 3200);

    return () => { clearTimeout(t0); clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── ドットアニメーション（Phase 0 のみ） ──
  useEffect(() => {
    if (phase !== 0) return;
    const id = setInterval(() => setDotCount(d => (d % 3) + 1), 320);
    return () => clearInterval(id);
  }, [phase]);

  // ── スコア カウントアップ（Phase 1 開始時） ──
  useEffect(() => {
    if (phase !== 1) return;

    const duration = 1600; // ms
    const start    = performance.now();
    const target   = totalScore;

    // イージング: easeOutCubic
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);

    let rafId: number;
    const tick = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      setDisplayScore(Math.round(ease(progress) * target));
      if (progress < 1) {
        rafId = requestAnimationFrame(tick);
      } else {
        setDisplayScore(target);
      }
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [phase, totalScore]);

  // スコア色
  const scoreColor =
    totalScore >= 300 ? "#10b981" :
    totalScore >= 100 ? "#6366f1" :
    totalScore >= 0   ? "#f59e0b" : "#f43f5e";

  return (
    /* ── 全画面オーバーレイ ── */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ backgroundColor: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)" }}
    >
      {/* ── 中央カード ── */}
      <div
        className="w-full bg-white rounded-3xl shadow-2xl overflow-hidden"
        style={{
          maxWidth: 480,
          transition: "opacity 0.35s ease-out, transform 0.35s ease-out",
          opacity:   cardVisible ? 1 : 0,
          transform: cardVisible ? "scale(1)" : "scale(0.88)",
        }}
      >
        {/* カードヘッダー帯 */}
        <div
          className="px-6 pt-6 pb-4 text-center"
          style={{ background: "linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)" }}
        >
          <div className="text-indigo-300 text-xs font-mono tracking-widest uppercase mb-1">
            Analysis Result
          </div>
          <div className="text-white font-black text-lg">結果発表</div>
        </div>

        {/* カードボディ */}
        <div className="px-6 py-8 text-center min-h-52 flex flex-col items-center justify-center gap-4">

          {/* ── Phase 0: 分析中 ── */}
          <div
            style={{
              transition: "opacity 0.3s, transform 0.3s",
              opacity:   phase === 0 ? 1 : 0,
              transform: phase === 0 ? "translateY(0)" : "translateY(-12px)",
              position:  phase === 0 ? "relative" : "absolute",
              pointerEvents: "none",
            }}
          >
            <div className="w-12 h-12 mx-auto mb-4 rounded-full border-4 border-indigo-200 border-t-indigo-500"
              style={{ animation: "spin 0.8s linear infinite" }} />
            <div className="text-slate-600 text-lg font-bold tracking-wide">
              分析中{"．".repeat(dotCount)}
            </div>
            <div className="text-slate-400 text-xs mt-1">選択した顧客を分析しています</div>
          </div>

          {/* ── Phase 1+: スコア ── */}
          <div
            style={{
              transition: "opacity 0.45s ease-out, transform 0.45s ease-out",
              opacity:   phase >= 1 ? 1 : 0,
              transform: phase >= 1 ? "translateY(0)" : "translateY(16px)",
            }}
          >
            {/* スコア数字 */}
            <div
              className="font-black leading-none mb-1 tabular-nums"
              style={{ fontSize: "clamp(3.5rem, 16vw, 5rem)", color: scoreColor,
                textShadow: `0 0 40px ${scoreColor}40` }}
            >
              {displayScore > 0 ? "+" : ""}{displayScore}
            </div>
            <div className="text-slate-500 text-sm font-semibold">点</div>

            {/* タイプ別ミニ集計 */}
            <div className="flex justify-center gap-3 mt-4 flex-wrap">
              {(["Persuadable","Sure Thing","Lost Cause","Sleeping Dog"] as CustomerType[]).map(type => {
                const cnt = selectedCustomers.filter(c => c.type === type).length;
                if (cnt === 0) return null;
                const m = TYPE_META[type];
                return (
                  <div key={type}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${m.bg} ${m.border} border`}>
                    <span>{m.emoji}</span>
                    <span className={m.color}>{m.label}</span>
                    <span className={`font-black ${m.color}`}>{cnt}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Phase 2+: コメント ── */}
          <div
            className="w-full"
            style={{
              transition: "opacity 0.4s ease-out, transform 0.4s ease-out",
              opacity:   phase >= 2 ? 1 : 0,
              transform: phase >= 2 ? "translateY(0)" : "translateY(20px)",
            }}
          >
            <div className="bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-center">
              <div className="text-slate-800 font-black text-base mb-1">{headline}</div>
              <div className="text-slate-500 text-sm leading-relaxed whitespace-pre-line">{body}</div>
            </div>
          </div>
        </div>

        {/* ── Phase 3+: 詳細を見るボタン ── */}
        <div
          className="px-6 pb-6"
          style={{
            transition: "opacity 0.4s ease-out, transform 0.4s ease-out",
            opacity:   phase >= 3 ? 1 : 0,
            transform: phase >= 3 ? "translateY(0)" : "translateY(12px)",
          }}
        >
          <button
            onClick={onClose}
            disabled={phase < 3}
            className="w-full py-4 rounded-2xl font-black text-base text-white transition-all duration-200 active:scale-[0.97]"
            style={{
              background: phase >= 3
                ? "linear-gradient(135deg, #6366f1, #8b5cf6)"
                : "#e2e8f0",
              color: phase >= 3 ? "white" : "#94a3b8",
              boxShadow: phase >= 3 ? "0 4px 24px rgba(99,102,241,0.35)" : "none",
            }}
          >
            詳細を見る →
          </button>
        </div>
      </div>

      {/* スピナー用 CSS キーフレーム */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ─────────────────────────────────────────────
// メインアプリ
// ─────────────────────────────────────────────
export default function App() {
  const [screen,       setScreen]       = useState<Screen>("intro"); // 起動時は導入画面から開始
  const [difficulty,   setDifficulty]   = useState<Difficulty>("easy");
  const [customers,    setCustomers]    = useState<Customer[]>([]);
  const [selectedIds,  setSelectedIds]  = useState<Set<string>>(new Set());
  // v1.6: 結果発表モーダル表示フラグ
  const [showReveal,   setShowReveal]   = useState(false);

  const handleStart = useCallback((diff: Difficulty) => {
    setDifficulty(diff);
    setCustomers(generateCustomers(diff));
    setSelectedIds(new Set());
    setScreen("game");
  }, []);

  const handleToggle = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else              next.add(id);
      return next;
    });
  }, []);

  // v1.6: 「結果を見る」→ モーダル表示（即 result 遷移しない）
  const handleSubmit  = useCallback(() => setShowReveal(true),  []);
  // v1.6: モーダルの「詳細を見る」→ モーダルを閉じて result へ
  const handleRevealClose = useCallback(() => {
    setShowReveal(false);
    setScreen("result");
  }, []);

  const handleRestart = useCallback(() => setScreen("title"),  []);

  const selectedCustomers = customers.filter(c => selectedIds.has(c.id));

  return (
    <>
      {screen === "intro"  && <IntroScreen onNext={() => setScreen("title")} />}
      {screen === "title"  && <TitleScreen onStart={handleStart} />}
      {screen === "game"  && (
        <GameScreen customers={customers} selectedIds={selectedIds}
          difficulty={difficulty} onToggle={handleToggle} onSubmit={handleSubmit} />
      )}
      {screen === "result" && (
        <ResultScreen
          selectedCustomers={selectedCustomers}
          allCustomers={customers}
          difficulty={difficulty}
          onRestart={handleRestart}
        />
      )}

      {/* v1.6: 結果発表モーダル（game 画面の上に重ねる） */}
      {showReveal && (
        <ResultRevealModal
          selectedCustomers={selectedCustomers}
          onClose={handleRevealClose}
        />
      )}
    </>
  );
}
