/**
 * One traffic road actor: cloned engine vehicle meshes with a per-vehicle
 * body color, plus the pose/wheel-spin application. All road math lives in
 * TrafficManager; this class only owns the THREE objects.
 *
 * The engine hands us its minified THREE module; constructors are resolved
 * defensively (named export first, minified letter fallback) the same way the
 * instrument cluster does.
 */

function trafficResolveThree(THREE) {
  return {
    Group: THREE.Group || THREE.G,
    Vector3: THREE.Vector3 || THREE.W,
  };
}

/**
 * Loads and caches the engine's vehicle OBJ assets (one template per vehicle
 * definition), so each traffic vehicle is a cheap `.clone()`. Materials are
 * the engine's shared `_d` palette, except body/livery meshes which get a
 * per-vehicle colored clone of the body material.
 */
class TrafficAssets {
  constructor(handles) {
    this.h = handles;
    this.cache = {}; // def.name -> { body, wheel, waiters, failed }
  }

  /** True once a def's assets are known to be missing (e.g. 404 OBJ). */
  isFailed(name) {
    const entry = this.cache[name];
    return !!(entry && entry.failed);
  }

  /** cb(bodyTemplate, wheelTemplate) once both OBJs are parsed; onFail() if they never will. */
  load(def, cb, onFail) {
    const entry = this.cache[def.name] || (this.cache[def.name] = { body: null, wheel: null, waiters: [], failWaiters: [], failed: false });
    if (entry.failed) {
      if (onFail) onFail();
      return;
    }
    if (onFail) entry.failWaiters.push(onFail);
    if (entry.body && entry.wheel) {
      cb(entry.body, entry.wheel);
      return;
    }
    entry.waiters.push(cb);
    if (entry.loading) return;
    entry.loading = true;
    let Loader;
    try {
      Loader = this.h.objLoader.OBJLoader || this.h.objLoader.a;
    } catch (_e) {
      entry.failed = true;
      return;
    }
    const loader = new Loader();
    const done = () => {
      if (entry.body && entry.wheel) {
        entry.failWaiters.length = 0;
        const waiters = entry.waiters.splice(0);
        for (const w of waiters) {
          try {
            w(entry.body, entry.wheel);
          } catch (_e) {
            /* one bad waiter must not break the rest */
          }
        }
      }
    };
    const fail = () => {
      // Assets missing (the checked-in static/media set is incomplete — e.g.
      // the Coach OBJs). Tell every pending vehicle so the manager recycles
      // it instead of leaving an invisible actor in the registry.
      entry.failed = true;
      entry.waiters.length = 0;
      const fws = entry.failWaiters.splice(0);
      for (const f of fws) {
        try {
          f();
        } catch (_e) {
          /* ignore */
        }
      }
    };
    try {
      loader.load(
        def.bodyObj.default,
        (obj) => {
          this._prepTemplate(obj);
          obj.rotation.y = -Math.PI / 2; // OBJ is modeled along +x; engine convention
          entry.body = obj;
          done();
        },
        undefined,
        fail
      );
      const wheelLoader = new Loader();
      wheelLoader.load(
        def.wheelObj.default,
        (obj) => {
          this._prepTemplate(obj, true);
          entry.wheel = obj;
          done();
        },
        undefined,
        fail
      );
    } catch (_e) {
      fail();
    }
  }

  /**
   * Assign the engine's shared materials by mesh-name suffix (mirrors the
   * engine's initVehicle traversal). Body and livery-map meshes are tagged so
   * each cloned vehicle can swap in its own colored material.
   */
  _prepTemplate(obj, isWheel) {
    const mats = this.h.materials;
    obj.traverse((m) => {
      if (!m.isMesh) return;
      const kind = m.name.split('_')[1];
      if (!isWheel && (kind === 'body' || kind === 'map')) {
        m.material = mats.body;
        m.userData.pdTrafficBody = true;
      } else if (kind in mats) {
        m.material = mats[kind];
      } else {
        m.material = isWheel ? mats.wheel : mats.default;
      }
      m.frustumCulled = false; // parents move every frame; skip per-mesh culling
    });
  }
}

class TrafficVehicle {
  /**
   * opts: { id, def, lane (signed int, +fwd/-oncoming), node, t, speed,
   *         targetSpeed, color, mode ('driving'|'stopped'|'crashed'), event }
   */
  constructor(opts, handles) {
    this.h = handles;
    this.T = trafficResolveThree(handles.THREE);
    this.id = opts.id;
    this.def = opts.def;
    this.lane = opts.lane;
    this.dir = opts.lane > 0 ? 1 : -1;
    this.node = opts.node;
    this.t = opts.t || 0;
    this.speed = opts.speed || 0;
    this.cruiseSpeed = opts.targetSpeed != null ? opts.targetSpeed : opts.speed || 0;
    this.targetSpeed = this.cruiseSpeed;
    this.mode = opts.mode || 'driving';
    this.event = !!opts.event; // event spawns don't count toward density
    this.color = opts.color;
    // Collision box (road-aligned): origin is the rear axle, so the box
    // centre sits half a wheelbase ahead. Overhangs approximated from the
    // wheelbase; width is the real track incl. tyres — kept tight so a
    // correct-lane pass against oncoming traffic never registers contact.
    this.length = opts.def.wheels.length + 1.2;
    this.width = opts.def.wheels.width + 2 * opts.def.wheels.tyreWidth;
    this.centerOffset = opts.def.wheels.length / 2;
    this.wheelRadius = opts.def.wheels.radius;
    this.wheelRoll = 0;
    this.wheelMeshes = [];
    this.group = null;
    this.ready = false; // meshes still loading; skip pose/render until true
    this.arcFloat = 0; // node.i + t, maintained by the manager
    this.lat = 0; // signed lateral offset actually applied (for collisions)
    this.pushLat = 0; // decaying lateral shove from collisions
    this.pushArc = 0; // decaying longitudinal shove from collisions
  }

  /** Build the THREE objects from cached templates and add them to `parent`. */
  build(assets, parent) {
    assets.load(
      this.def,
      (bodyTpl, wheelTpl) => {
        if (this.disposed) return;
        const g = new this.T.Group();
        g.rotation.order = 'YXZ';
        const body = bodyTpl.clone(true);
        // Per-vehicle body color: one cloned material shared by this clone's
        // tagged meshes.
        let bodyMat = null;
        body.traverse((m) => {
          if (m.isMesh && m.userData.pdTrafficBody) {
            if (!bodyMat) {
              bodyMat = m.material.clone();
              bodyMat.color.setHex(this.color);
            }
            m.material = bodyMat;
          }
        });
        this.bodyMaterial = bodyMat;
        g.add(body);
        const w = this.def.wheels;
        const wheelSlots = [
          { x: w.width / 2, z: w.length, y: Math.PI / 2 }, // fl
          { x: -w.width / 2, z: w.length, y: -Math.PI / 2 }, // fr
          { x: w.width / 2, z: 0, y: Math.PI / 2 }, // rl
          { x: -w.width / 2, z: 0, y: -Math.PI / 2 }, // rr
        ];
        for (const slot of wheelSlots) {
          const wm = wheelTpl.clone(true);
          wm.traverse((c) => {
            if (c.isMesh) c.position.z -= w.tyreWidth;
          });
          wm.rotation.order = 'YXZ';
          wm.rotation.y = slot.y;
          wm.position.set(slot.x, w.radius, slot.z);
          wm.userData.side = slot.y > 0 ? 1 : -1;
          this.wheelMeshes.push(wm);
          g.add(wm);
        }
        g.frustumCulled = false;
        this.group = g;
        parent.add(g);
        this.ready = true;
      },
      () => {
        // Assets will never arrive — flag for the manager to recycle so no
        // invisible actor lingers in the sensor registry.
        this.loadFailed = true;
      }
    );
  }

  /** Apply a world pose. yaw follows the engine convention (0 = +z). */
  setPose(x, y, z, yaw, pitch) {
    if (!this.ready) return;
    this.group.position.set(x, y, z);
    this.group.rotation.set(pitch || 0, yaw, 0);
  }

  /** Spin the wheels for the distance travelled this frame. */
  spinWheels(ds) {
    if (!this.ready || !ds) return;
    this.wheelRoll += ds / this.wheelRadius;
    for (const wm of this.wheelMeshes) {
      // The engine rolls its wheels on the Z euler component (after the ±90°
      // yaw that faces the mesh outward; left +, right −) — see the ego's
      // wheelEulers updates. X here would flip the disc into the road plane.
      wm.rotation.z = this.wheelRoll * wm.userData.side;
    }
  }

  dispose(parent) {
    this.disposed = true;
    if (this.group) {
      parent.remove(this.group);
      if (this.bodyMaterial) {
        try {
          this.bodyMaterial.dispose();
        } catch (_e) {
          /* renderer may already hold no reference */
        }
      }
      this.group = null;
    }
    this.ready = false;
  }
}
