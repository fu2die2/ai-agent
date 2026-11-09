type Props = {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
};

export function ChatInput({ value, disabled, onChange, onSubmit }: Props) {
  return (
    <form
      className="border-t border-white/8 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="flex items-end gap-3 rounded-2xl border border-white/10 bg-[#161922] px-4 py-3">
        <textarea
          value={value}
          disabled={disabled}
          rows={1}
          placeholder="メッセージを入力..."
          className="max-h-32 min-h-11 flex-1 resize-none bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              onSubmit();
            }
          }}
        />
        <button
          type="submit"
          disabled={disabled || !value.trim()}
          className="rounded-xl bg-cyan-400 px-4 py-2 text-sm font-medium text-zinc-950 disabled:opacity-40"
        >
          送信
        </button>
      </div>
    </form>
  );
}
