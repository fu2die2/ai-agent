import type { KeyboardEvent } from "react";

type Props = {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
};

function isComposingEvent(event: KeyboardEvent<HTMLTextAreaElement>) {
  return event.nativeEvent.isComposing || event.keyCode === 229;
}

export function ChatInput({ value, disabled, onChange, onSubmit }: Props) {
  return (
    <form
      className="border-t border-slate-200 bg-white p-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="flex items-end gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
        <textarea
          value={value}
          disabled={disabled}
          rows={2}
          placeholder="メッセージを入力...（Ctrl + Enter で送信）"
          className="max-h-40 min-h-14 flex-1 resize-none bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400"
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (isComposingEvent(event)) return;
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              onSubmit();
            }
          }}
        />
        <button
          type="submit"
          disabled={disabled || !value.trim()}
          className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          送信
        </button>
      </div>
    </form>
  );
}
