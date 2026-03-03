import { Alert, Button, Card } from "antd";
import React from "react";

type Props = {
  children: React.ReactNode;
};

type State = {
  hasError: boolean;
  errorMessage: string;
};

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, errorMessage: "" };
  }

  static getDerivedStateFromError(error: unknown): State {
    const msg = error instanceof Error ? error.message : String(error || "Unknown error");
    return { hasError: true, errorMessage: msg };
  }

  componentDidCatch(error: unknown) {
    // Keep console trace for local debugging.
    // eslint-disable-next-line no-console
    console.error("UI runtime error", error);
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }
    return (
      <Card>
        <Alert
          type="error"
          showIcon
          message="Page rendering failed"
          description={
            <div>
              <div>UI encountered a runtime error. Use refresh or return dashboard.</div>
              <pre style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{this.state.errorMessage}</pre>
            </div>
          }
          action={
            <Button size="small" onClick={() => window.location.assign("/app/dashboard")}>
              Back to Dashboard
            </Button>
          }
        />
      </Card>
    );
  }
}
