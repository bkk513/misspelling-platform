export function HomePage() {
  return (
    <div className="stack">
      <section className="panel">
        <h2>Researcher Entry</h2>
        <p className="muted">
          M6 scaffold initialized. Next commits will add health checks, task creation, recent tasks, and task detail polling.
        </p>
      </section>
      <section className="panel grid-two">
        <div>
          <h3>Word Analysis</h3>
          <div className="field">
            <label>word</label>
            <input value="demo" readOnly />
          </div>
          <button disabled>Create Task (next commit)</button>
        </div>
        <div>
          <h3>Simulation Run</h3>
          <div className="field">
            <label>n</label>
            <input value="20" readOnly />
          </div>
          <div className="field">
            <label>steps</label>
            <input value="15" readOnly />
          </div>
          <button disabled>Create Task (next commit)</button>
        </div>
      </section>
    </div>
  );
}
