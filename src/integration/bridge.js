/**
 * src/integration/bridge.js
 * Bidirectional communication channel between WorlDrive and Prompt Drive via postMessage
 */

let activeMetricsInstance = null;

if (typeof window !== 'undefined' && window.DrivingMetrics) {
    const _originalStopRun = window.DrivingMetrics.prototype.stopRun;
    window.DrivingMetrics.prototype.stopRun = function(...args) {
        const result = _originalStopRun.apply(this, args);
        const report = this.buildReport?.() || {};
        window.parent.postMessage({ type: 'METRICS_REPORT', data: report }, '*');
        return result;
    };

    const _originalSample = window.DrivingMetrics.prototype.sample;
    window.DrivingMetrics.prototype.sample = function(...args) {
        if (activeMetricsInstance !== this) {
            activeMetricsInstance = this;
        }
        return _originalSample.apply(this, args);
    };
} else {
    console.warn('bridge.js: window.DrivingMetrics is not defined. Make sure bridge.js is loaded after metrics.js.');
}

window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'INIT') {
        if (event.data.lanes && typeof window !== 'undefined' && window.LaneRoads) {
            const current = window.LaneRoads.get();
            const requested = event.data.lanes;
            if (
                current.forward !== requested.forward ||
                current.backward !== requested.backward ||
                current.width !== requested.width
            ) {
                window.LaneRoads.set(requested);
                window.LaneRoads.apply();
            }
        }
        if (event.data.autostart) {
            if (activeMetricsInstance && typeof activeMetricsInstance.startRun === 'function' && !activeMetricsInstance.isRecording) {
                activeMetricsInstance.startRun();
            } else if (!activeMetricsInstance) {
                // If instance is not yet available, poll until it is
                const interval = setInterval(() => {
                    if (activeMetricsInstance && typeof activeMetricsInstance.startRun === 'function' && !activeMetricsInstance.isRecording) {
                        activeMetricsInstance.startRun();
                        clearInterval(interval);
                    }
                }, 100);
                setTimeout(() => clearInterval(interval), 5000);
            }
        }
    } else if (event.data && event.data.type === 'PROMPT_ACTIVE') {
        if (event.data.sim_lanes && typeof window !== 'undefined' && window.LaneRoads) {
            try {
                const requested = typeof event.data.sim_lanes === 'string'
                    ? JSON.parse(event.data.sim_lanes)
                    : event.data.sim_lanes;
                const current = window.LaneRoads.get();
                if (
                    current.forward !== requested.forward ||
                    current.backward !== requested.backward ||
                    current.width !== requested.width
                ) {
                    window.LaneRoads.set(requested);
                    window.LaneRoads.apply();
                }
            } catch (e) {
                console.warn('[bridge] PROMPT_ACTIVE: sim_lanes parse error', e);
            }
        }
    } else if (event.data && event.data.type === 'TOGGLE_CONSOLE') {
        if (activeMetricsInstance && activeMetricsInstance.overlay) {
            activeMetricsInstance.overlay.setVisible(!!event.data.visible);
        }
    }
});

window.addEventListener('load', () => {
    window.parent.postMessage({ type: 'READY' }, '*');
});
