export function TaskDetailPage({ taskId }: { taskId: string }) {
  return (
    <div className="panel">
      <h2>Task Detail</h2>
      <p className="mono">{taskId}</p>
      <p className="muted">M6 next commits will add polling, lifecycle events, artifacts, and time series chart.</p>
    </div>
  );
}
