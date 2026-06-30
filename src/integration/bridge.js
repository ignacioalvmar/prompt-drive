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
    }
});

window.addEventListener('load', () => {
    window.parent.postMessage({ type: 'READY' }, '*');
});
