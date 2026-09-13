const RISK_LEVELS = [
  { key: "low", label: "Low", color: "#4f9d78" },
  { key: "moderate", label: "Moderate", color: "#d9a441" },
  { key: "high", label: "High", color: "#c1502e" },
  { key: "severe", label: "Severe", color: "#7a2418" },
];

export default function InfoPanel({ activeLayer, identifyResult }) {
  if (!activeLayer) return null;

  return (
    <div
      style={{
        position: "absolute",
        right: 16,
        bottom: 16,
        width: 260,
        background: "rgba(15, 27, 35, 0.92)",
        color: "var(--text-hi)",
        borderRadius: "var(--radius)",
        border: "1px solid var(--line)",
        padding: 14,
        fontSize: 13,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 6 }}>{activeLayer.name}</div>
      {activeLayer.unit && (
        <div style={{ color: "var(--text-lo)", marginBottom: 8 }}>Unit: {activeLayer.unit}</div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: identifyResult ? 12 : 0 }}>
        {RISK_LEVELS.map((r) => (
          <div key={r.key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 12, height: 12, background: r.color, borderRadius: 2 }} />
            <span>{r.label}</span>
          </div>
        ))}
      </div>

      {identifyResult && (
        <div style={{ borderTop: "1px solid var(--line)", paddingTop: 10 }}>
          <div style={{ color: "var(--text-lo)" }}>At clicked location</div>
          {identifyResult.risk_class ? (
            <div>Risk class: {identifyResult.risk_class}</div>
          ) : (
            <div>No feature at this point</div>
          )}
          {identifyResult.value != null && <div>Value: {identifyResult.value}</div>}
        </div>
      )}
    </div>
  );
}
