"use client";

import { useState } from "react";
import { motion } from "motion/react";

// A compact, dependency-free emoji picker. Curated sets per category — enough
// for everyday chat without shipping a megabyte of emoji data.
const CATEGORIES: { id: string; label: string; emojis: string[] }[] = [
  {
    id: "smileys",
    label: "😀",
    emojis: [
      "😀","😃","😄","😁","😆","😅","🤣","😂","🙂","🙃","😉","😊","😇","🥰","😍","🤩","😘","😗","😚","😙","😋","😛","😜","🤪","😝","🤑","🤗","🤭","🤫","🤔","🤐","😐","😑","😶","😏","😒","🙄","😬","😮‍💨","🤥","😌","😔","😪","🤤","😴","😷","🤒","🤕","🤢","🤮","🥵","🥶","🥴","😵","🤯","🤠","🥳","😎","🤓","🧐","😕","😟","🙁","😮","😯","😲","😳","🥺","😦","😧","😨","😰","😥","😢","😭","😱","😖","😣","😞","😓","😩","😫","🥱","😤","😡","😠","🤬","😈","👿","💀","💩","🤡","👻","👽","🤖",
    ],
  },
  {
    id: "gestures",
    label: "👍",
    emojis: [
      "👍","👎","👌","🤌","🤏","✌️","🤞","🤟","🤘","🤙","👈","👉","👆","👇","☝️","👋","🤚","🖐️","✋","🖖","👏","🙌","👐","🤲","🤝","🙏","✊","👊","🤛","🤜","💪","🦾","✍️","💅","🤳","💯","🔥","✨","⭐","🌟","💫","💥","💢","💦","💨","🕳️",
    ],
  },
  {
    id: "hearts",
    label: "❤️",
    emojis: [
      "❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎","💔","❣️","💕","💞","💓","💗","💖","💘","💝","💟","♥️","💌","😻","🥰","😍",
    ],
  },
  {
    id: "animals",
    label: "🐻",
    emojis: [
      "🐶","🐱","🐭","🐹","🐰","🦊","🐻","🐼","🐨","🐯","🦁","🐮","🐷","🐸","🐵","🐔","🐧","🐦","🐤","🦄","🐝","🦋","🐌","🐞","🐢","🐍","🐙","🦑","🦀","🐠","🐟","🐬","🐳","🐋","🦈","🐊","🐅","🐆","🦓","🦍","🐘","🦏","🐪","🐫","🦒","🐃","🐎","🐖","🐏","🐑","🌷","🌹","🌸","🌻","🌼","🌳","🌲","🌴","🌵","🍀","🍁","🍂","🌍","🌙","⭐","☀️","⛅","🌧️","⚡","❄️",
    ],
  },
  {
    id: "food",
    label: "🍔",
    emojis: [
      "🍏","🍎","🍐","🍊","🍋","🍌","🍉","🍇","🍓","🫐","🍒","🍑","🥭","🍍","🥥","🥝","🍅","🥑","🥦","🌽","🥕","🥔","🍞","🧀","🥚","🍳","🥞","🥓","🍔","🍟","🍕","🌭","🥪","🌮","🌯","🥗","🍝","🍜","🍲","🍣","🍱","🍛","🍚","🍦","🍰","🎂","🍪","🍩","🍫","🍬","🍭","🍿","🧂","☕","🍵","🍺","🍻","🥂","🍷","🥃","🍸","🍹","🧃","🥤",
    ],
  },
  {
    id: "activity",
    label: "⚽",
    emojis: [
      "⚽","🏀","🏈","⚾","🥎","🎾","🏐","🏉","🎱","🏓","🏸","🥅","🏒","🏑","🥍","🏏","⛳","🎯","🪀","🎮","🕹️","🎰","🎲","🧩","🎨","🎬","🎤","🎧","🎼","🎹","🥁","🎷","🎺","🎸","🎻","🏆","🥇","🥈","🥉","🏅","🎖️","✈️","🚗","🚕","🚙","🚌","🏎️","🚓","🚑","🚒","🚲","🛵","🏍️","🚀","🛸","🚁","⛵","🚤","🗽","🗼","🏰","🎡","🎢","🎠","⛱️","🏖️","🏝️",
    ],
  },
  {
    id: "objects",
    label: "💡",
    emojis: [
      "⌚","📱","💻","⌨️","🖥️","🖨️","🖱️","💽","💾","📷","📸","📹","🎥","📞","☎️","📺","📻","🔋","🔌","💡","🔦","📡","💰","💵","💳","💎","🔧","🔨","🛠️","⚙️","🔑","🗝️","🔒","🔓","📌","📎","✂️","📏","📐","🖊️","✏️","📝","📚","📖","📰","🗞️","📦","📧","📨","📩","✅","❌","⭕","❗","❓","💤","🔔","🔕","📣","📢","🎁","🎉","🎊","🎈","🛒",
    ],
  },
  {
    id: "symbols",
    label: "🔣",
    emojis: [
      "✔️","➕","➖","➗","✖️","💲","💱","©️","®️","™️","🔝","🔙","🔚","🔛","🔜","⚠️","🚸","⛔","🚫","💯","🔞","📵","🔇","🔈","🔉","🔊","🆗","🆒","🆕","🆓","🅰️","🅱️","🆎","🆑","🔴","🟠","🟡","🟢","🔵","🟣","⚫","⚪","🟤","🔺","🔻","🔶","🔷","🔸","🔹","♻️","✳️","❇️","➰","➿","〽️","🔱","🔰","⁉️","‼️","〰️","♾️",
    ],
  },
];

export function EmojiPicker({
  onPick,
  onClose,
}: {
  onPick: (emoji: string) => void;
  onClose: () => void;
}) {
  const [cat, setCat] = useState(0);

  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, y: 6, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 6, scale: 0.98 }}
        transition={{ duration: 0.14, ease: "easeOut" }}
        className="absolute bottom-full left-2 z-20 mb-2 w-72 origin-bottom-left overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-0.5 border-b border-slate-100 px-1.5 py-1 dark:border-neutral-700">
          {CATEGORIES.map((c, i) => (
            <button
              key={c.id}
              onClick={() => setCat(i)}
              className={`flex-1 rounded-lg py-1 text-base transition ${
                i === cat
                  ? "bg-slate-100 dark:bg-neutral-700"
                  : "hover:bg-slate-50 dark:hover:bg-neutral-700/50"
              }`}
              title={c.id}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="scroll-thin grid max-h-52 grid-cols-8 gap-0.5 overflow-y-auto p-1.5">
          {CATEGORIES[cat].emojis.map((e, i) => (
            <button
              key={`${e}-${i}`}
              onClick={() => onPick(e)}
              className="rounded-lg py-1 text-xl leading-none transition hover:bg-slate-100 dark:hover:bg-neutral-700"
            >
              {e}
            </button>
          ))}
        </div>
      </motion.div>
    </>
  );
}
