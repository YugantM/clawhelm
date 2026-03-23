export const MODEL_OPTIONS = [
  { id: "auto", label: "Auto (recommended)", endpoint: "/chat" },
  { id: "deepseek", label: "DeepSeek (free)", endpoint: "/chat" },
  { id: "mistral", label: "Mistral (free)", endpoint: "/chat" },
  { id: "openchat", label: "OpenChat (free)", endpoint: "/chat" },
];

export default function ModelSelector({ value, onChange, options = MODEL_OPTIONS }) {
  return (
    <label className="model-selector">
      <span className="model-selector__label">Model</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
