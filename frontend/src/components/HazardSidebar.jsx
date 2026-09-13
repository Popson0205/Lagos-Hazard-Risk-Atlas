export default function HazardSidebar({
  hazards,
  scenarios,
  activeHazardId,
  activeScenarioId,
  onSelectHazard,
  onSelectScenario,
  showImagery,
  onToggleImagery,
}) {
  return (
    <aside
      style={{
        width: 300,
        background: "var(--ink)",
        color: "var(--text-hi)",
        display: "flex",
        flexDirection: "column",
        borderRight: "1px solid var(--line)",
      }}
    >
      <header style={{ padding: "20px 20px 16px", borderBottom: "1px solid var(--line)" }}>
        <div style={{ fontSize: 12, letterSpacing: "0.02em", color: "var(--text-lo)" }}>
          Lagos State
        </div>
        <h1 style={{ fontSize: 19, fontWeight: 600, margin: "2px 0 0" }}>
          Climate Hazard Risk Atlas
        </h1>
      </header>

      <nav style={{ flex: 1, overflowY: "auto", padding: "12px 8px" }}>
        <SectionLabel>Hazard theme</SectionLabel>
        {hazards.map((h) => (
          <button
            key={h.id}
            onClick={() => onSelectHazard(h.id === activeHazardId ? null : h.id)}
            style={rowStyle(h.id === activeHazardId)}
          >
            {h.name}
          </button>
        ))}

        <SectionLabel style={{ marginTop: 20 }}>Scenario</SectionLabel>
        {scenarios.map((s) => (
          <button
            key={s.id}
            onClick={() => onSelectScenario(s.id)}
            style={rowStyle(s.id === activeScenarioId)}
          >
            {s.label}
          </button>
        ))}

        <SectionLabel style={{ marginTop: 20 }}>Imagery</SectionLabel>
        <button onClick={onToggleImagery} style={rowStyle(showImagery)}>
          Sentinel-2 (Planetary Computer)
        </button>
      </nav>

      <footer style={{ padding: "14px 20px", borderTop: "1px solid var(--line)", fontSize: 12, color: "var(--text-lo)" }}>
        Click the map to identify a location within the active layer.
      </footer>
    </aside>
  );
}

function SectionLabel({ children, style }) {
  return (
    <div
      style={{
        fontSize: 11,
        color: "var(--text-lo)",
        padding: "6px 12px 4px",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function rowStyle(active) {
  return {
    display: "block",
    width: "100%",
    textAlign: "left",
    background: active ? "var(--ink-soft)" : "transparent",
    color: active ? "var(--accent)" : "var(--text-hi)",
    border: "none",
    borderRadius: "var(--radius)",
    padding: "9px 12px",
    fontSize: 14,
    cursor: "pointer",
    marginBottom: 2,
  };
}
