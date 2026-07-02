interface Props {
    projectId?: string;
}

export function AnalyticsDashboard({ projectId }: Props) {
    return (
        <div className="analytics-dashboard">
            <h2>Analytics Dashboard</h2>
            <p>Project: {projectId}</p>
        </div>
    );
}
