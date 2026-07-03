/**
 * src/integration/bridge.js
 * Bidirectional communication channel between WorlDrive and Prompt Drive via postMessage
 */

// Sanitize corrupted telemetry in localStorage before the engine loops
if (typeof window !== 'undefined' && window.localStorage) {
    ['analytics_totalTime', 'analytics_totalDist'].forEach(key => {
        try {
            const val = window.localStorage.getItem(key);
            if (val !== null && Number.isNaN(Number(val))) {
                window.localStorage.removeItem(key);
                console.debug(`[bridge] Cleared corrupted telemetry key on load: ${key}`);
            }
        } catch (e) {
            // Ignore storage access errors
        }
    });
}

let activeMetricsInstance = null;

if (typeof window !== 'undefined' && window.DrivingMetrics) {
    const _originalStopRun = window.DrivingMetrics.prototype.stopRun;
    window.DrivingMetrics.prototype.stopRun = function(...args) {
        const result = _originalStopRun.apply(this, args);
        
        // Secondary layer: sanitize intra-session corruption immediately after stopRun
        if (typeof window !== 'undefined' && window.localStorage) {
            ['analytics_totalTime', 'analytics_totalDist'].forEach(key => {
                try {
                    const val = window.localStorage.getItem(key);
                    if (val !== null && Number.isNaN(Number(val))) {
                        window.localStorage.removeItem(key);
                        console.debug(`[bridge] Cleared corrupted telemetry key after stopRun: ${key}`);
                    }
                } catch (e) {
                    // Ignore storage access errors
                }
            });
        }

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
        let needsReload = false;
        
        if (typeof window !== 'undefined' && window.PromptDrive) {
            const current = window.PromptDrive.get();
            const pendingStatic = {};

            if (event.data.sim_topo !== undefined && String(current.scene.topography) !== String(event.data.sim_topo)) {
                needsReload = true;
                pendingStatic['scene.topography'] = event.data.sim_topo;
            }
            if (event.data.sim_seed !== undefined && String(current.scene.seed) !== String(event.data.sim_seed)) {
                needsReload = true;
                pendingStatic['scene.seed'] = event.data.sim_seed;
            }
            if (event.data.sim_node !== undefined && String(current.scene.startNode) !== String(event.data.sim_node)) {
                needsReload = true;
                pendingStatic['scene.startNode'] = Number(event.data.sim_node);
            }
            
            if (event.data.sim_traffic_density !== undefined && current.traffic && String(current.traffic.density) !== String(event.data.sim_traffic_density)) {
                needsReload = true;
                pendingStatic['traffic'] = { density: parseInt(event.data.sim_traffic_density, 10) };
            }

            // If we need a reload, we must persist sim_lanes so it survives
            if (needsReload && event.data.sim_lanes && typeof window !== 'undefined' && window.LaneRoads) {
                try {
                    const requested = typeof event.data.sim_lanes === 'string'
                        ? JSON.parse(event.data.sim_lanes)
                        : event.data.sim_lanes;
                    window.LaneRoads.set(requested);
                } catch (e) {}
            }

            if (needsReload) {
                if (event.data.sim_autodrive !== undefined && event.data.sim_autodrive !== null) {
                    sessionStorage.setItem('bridge_pending_autodrive', event.data.sim_autodrive.toString());
                }
                
                window.PromptDrive.config.set(pendingStatic);
                if (window.history && window.history.replaceState) {
                    window.history.replaceState({}, '', window.location.pathname + '?autostart=1');
                }
                window.PromptDrive.config.apply({mode: 'reload'});
                return;
            }
        }

        if (event.data.sim_lanes && typeof window !== 'undefined' && window.LaneRoads) {
            try {
                const requested = typeof event.data.sim_lanes === 'string'
                    ? JSON.parse(event.data.sim_lanes)
                    : event.data.sim_lanes;
                const current = window.LaneRoads.get();
                if (
                    Number(current.forward) !== Number(requested.forward) ||
                    Number(current.backward) !== Number(requested.backward) ||
                    Number(current.width) !== Number(requested.width)
                ) {
                    window.LaneRoads.set(requested);
                }
            } catch (e) {
                console.warn('[bridge] PROMPT_ACTIVE: sim_lanes parse error', e);
            }
        }
        if (event.data.sim_autodrive !== undefined && typeof window !== 'undefined' && window.PromptDrive) {
            const currentAutodrive = String(window.PromptDrive.get().autodrive);
            const requestedAutodrive = String(event.data.sim_autodrive);
            if (currentAutodrive !== requestedAutodrive) {
                window.PromptDrive.dynamic.autodrive(event.data.sim_autodrive === true || event.data.sim_autodrive === 'true');
            }
        }
    } else if (event.data && event.data.type === 'TOGGLE_CONSOLE') {
        if (activeMetricsInstance && activeMetricsInstance.overlay) {
            activeMetricsInstance.overlay.setVisible(!!event.data.visible);
        }
    }
});

window.addEventListener('load', () => {
    const pendingAutodrive = sessionStorage.getItem('bridge_pending_autodrive');
    if (pendingAutodrive !== null) {
        if (typeof window !== 'undefined' && window.PromptDrive) {
            window.PromptDrive.dynamic.autodrive(pendingAutodrive === 'true');
        }
        sessionStorage.removeItem('bridge_pending_autodrive');
    }
    window.parent.postMessage({ type: 'READY' }, '*');
});
