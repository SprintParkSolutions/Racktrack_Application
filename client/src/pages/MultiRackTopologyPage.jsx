import { useEffect, useMemo, useState, lazy, Suspense } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Environment, Grid, Line } from '@react-three/drei';
import { apiUrl, authFetch } from '../utils/api';
import styles from './MultiRackTopologyPage.module.css';

const RackBundle = lazy(() => import('./TopologyScene3D.jsx').then(m => ({
  default: ({ topo, xOffset, floorY, palette, selected, setSelected }) => (
    <m.RackContent
      topo={topo}
      xOffset={xOffset}
      floorY={floorY}
      palette={palette}
      selected={selected}
      setSelected={setSelected}
      // Hide neighbor-ghosts in multi-rack — the real neighbors are visible.
      showNeighbors={false}
    />
  ),
})));

// Lazy-import the constants and helpers we need at module level. Bundled
// into one async chunk with TopologyScene3D so we don't double-load it.
let _topoModule = null;
async function loadTopoModule() {
  if (!_topoModule) _topoModule = await import('./TopologyScene3D.jsx');
  return _topoModule;
}

// Friendly rack label ("Rack 1" / "#2") for an inter-rack link endpoint.
function labelForRack(placed, rackId) {
  const p = placed.find(x => x.member.rack_id === rackId);
  return p ? (p.member.label || `Rack ${p.member.position}`) : rackId;
}

// Live theme palette hook — same source TopologyScene3D uses internally.
// Imported lazily because TopologyScene3D pulls in three.js (~150kb).
function usePaletteHook() {
  const [palette, setPalette] = useState(null);
  useEffect(() => {
    let alive = true;
    loadTopoModule().then(m => {
      if (alive) setPalette(m.SCENE_PALETTES.dark); // initial guess
    });
  }, []);
  // Once loaded, swap to the live palette via a reactive read of the
  // theme attribute. We observe document for changes.
  useEffect(() => {
    const read = () => {
      const t = document.documentElement.getAttribute('data-theme');
      if (_topoModule) {
        setPalette(_topoModule.SCENE_PALETTES[t === 'light' ? 'light' : 'dark']);
      }
    };
    read();
    if (typeof MutationObserver === 'undefined') return;
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, {
      attributes: true, attributeFilter: ['data-theme'],
    });
    return () => mo.disconnect();
  }, []);
  return palette;
}

/**
 * Combined topology view for a multi-rack scan.
 *
 * Renders ALL member racks inside ONE shared <Canvas> — same floor, same
 * lights, same camera — laid out side-by-side at consistent X spacing.
 * This is the "one 3D space with 3 racks side-by-side with gaps" view,
 * not the old "N independent canvases in a grid" approach.
 *
 * Selection is scoped per-rack (a click on rack 2's switch doesn't dim
 * rack 1's devices) by keying selection state on rackId.
 */
export default function MultiRackTopologyPage() {
  const { groupId } = useParams();
  const navigate = useNavigate();

  const [group, setGroup] = useState(null);
  const [topos, setTopos] = useState({});  // rackId → topo JSON
  const [links, setLinks] = useState([]);  // synthesized inter-rack uplinks
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(true);
  // Per-rack selection so highlights stay scoped to one rack
  const [selectedByRack, setSelectedByRack] = useState({});  // rackId → {kind,id}|null

  const [layoutConsts, setLayoutConsts] = useState(null);
  const palette = usePaletteHook();

  useEffect(() => {
    loadTopoModule().then(m => setLayoutConsts({
      U_HEIGHT:     m.U_HEIGHT,
      DEV_WIDTH:    m.DEV_WIDTH,
      FOV_DEG:      m.FOV_DEG,
      RACK_SPACING: m.RACK_SPACING,
      computeRackLayout: m.computeRackLayout,
    }));
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const gRes = await authFetch(apiUrl(`/api/rack-group/${encodeURIComponent(groupId)}`));
        const gJson = await gRes.json();
        if (!gRes.ok) throw new Error(gJson.error || 'Group not found');
        if (!alive) return;
        setGroup(gJson);

        const topoMap = {};
        const errMap = {};
        await Promise.all((gJson.members || []).map(async (m) => {
          try {
            const r = await authFetch(apiUrl(`/api/topology/${m.rack_id}`));
            const data = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
            topoMap[m.rack_id] = data;
          } catch (e) {
            errMap[m.rack_id] = e.message;
          }
        }));
        if (!alive) return;
        setTopos(topoMap);
        setErrors(errMap);

        // Synthesized rack-to-rack uplinks (a realistic handful, not a mesh).
        try {
          const lRes = await authFetch(apiUrl(`/api/rack-group/${encodeURIComponent(groupId)}/links`));
          const lJson = await lRes.json().catch(() => ({}));
          if (alive && lRes.ok && Array.isArray(lJson.links)) setLinks(lJson.links);
        } catch (_) { /* non-fatal — racks still render without cross links */ }
      } catch (e) {
        if (alive) setErrors({ __group: e.message });
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [groupId]);

  const members = useMemo(() => group?.members || [], [group]);

  // Compute per-rack X offsets (centered around 0) and the camera framing
  // box (max chassisU and total scene width). All needed before the Canvas
  // is rendered, but only when both members AND topology data are loaded.
  const layout = useMemo(() => {
    if (!layoutConsts || !members.length) return null;
    const { computeRackLayout, U_HEIGHT, DEV_WIDTH, FOV_DEG, RACK_SPACING } = layoutConsts;
    const placed = members
      .filter(m => topos[m.rack_id])
      .map((m) => {
        const t = topos[m.rack_id];
        const totalU = t.u_size || 18;
        const { chassisU } = computeRackLayout(t, totalU);
        return { member: m, topo: t, chassisU };
      });
    if (!placed.length) return null;

    const n = placed.length;
    const maxChassisU = Math.max(...placed.map(p => p.chassisU));
    // Center the row of racks around X=0 so the camera target stays at origin
    const startX = -((n - 1) * RACK_SPACING) / 2;
    const withOffsets = placed.map((p, i) => ({
      ...p,
      xOffset: startX + i * RACK_SPACING,
    }));

    // Bounding box of the rack row (camera target = origin, sized at runtime
    // based on the actual canvas aspect inside <CameraRig>). We just hand
    // the scene dimensions through; the rig picks a real distance.
    const sceneH = maxChassisU * U_HEIGHT + 0.8;
    const sceneW = (n - 1) * RACK_SPACING + DEV_WIDTH + 1.0;
    const fovRad = (FOV_DEG * Math.PI) / 180;
    const tanHalf = Math.tan(fovRad / 2);
    // Conservative bound used for OrbitControls.maxDistance / fog. The
    // actual initial camera distance is set by CameraRig from real aspect.
    const camDistBound = Math.max(
      (sceneH * 1.1) / (2 * tanHalf),
      (sceneW * 1.1) / (2 * tanHalf * 0.55),
      8,
    );

    // World-Y of the shared floor — same formula DataCenterFloor uses.
    // Each rack lifts itself so its bottom hits this Y + clearance,
    // regardless of its individual chassisU.
    const floorY = -maxChassisU * U_HEIGHT / 2 - 0.4;
    // Visual center of the scene = midpoint of floor and tallest rack top.
    // Camera target uses this so the scene appears vertically centered in
    // the canvas (previously target=origin, which on the floor-aligned
    // layout left a sliver of empty above and a chunk of floor below).
    const tallestTop = floorY + 0.4 + maxChassisU * U_HEIGHT;
    const targetY = (floorY + tallestTop) / 2;

    return {
      placed: withOffsets,
      maxChassisU,
      sceneW,
      sceneH,
      camDistBound,
      floorY,
      targetY,
      U_HEIGHT,
      DEV_WIDTH,
    };
  }, [layoutConsts, members, topos]);

  if (loading || !layoutConsts) {
    return (
      <div className={styles.page}>
        <Header onBack={() => navigate(-1)} title="Combined topology" />
        <main className={styles.body}><div className={styles.spinner}>Loading…</div></main>
      </div>
    );
  }

  if (errors.__group) {
    return (
      <div className={styles.page}>
        <Header onBack={() => navigate(-1)} title="Combined topology" />
        <main className={styles.body}><div className={styles.err}>{errors.__group}</div></main>
      </div>
    );
  }

  if (!layout || !layout.placed.length) {
    return (
      <div className={styles.page}>
        <Header onBack={() => navigate(-1)} title="Combined topology" />
        <main className={styles.body}>
          <div className={styles.err}>
            No topology data yet for any rack in this scan.
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <Header
        onBack={() => navigate(-1)}
        title="Combined topology"
        extra={
          <span className={styles.groupTag}>
            {layout.placed.length} {layout.placed.length === 1 ? 'rack' : 'racks'}
          </span>
        }
      />
      <main className={styles.fullscreen}>
        <div
          className={styles.canvasShell}
          style={palette ? { background: palette.bg } : undefined}
        >
          <Suspense fallback={<div className={styles.spinner}>Rendering scene…</div>}>
            {palette && (
              <SharedScene layout={layout} palette={palette}
                links={links}
                selectedByRack={selectedByRack}
                setSelectedByRack={setSelectedByRack} />
            )}
          </Suspense>
        </div>

        {/* Per-rack quick-jump strip — sits in normal flow under the canvas,
            so the 3D scene doesn't have to fight a giant empty void below it. */}
        <div className={styles.rackStrip}>
          {layout.placed.map(p => (
            <button
              key={p.member.rack_id}
              className={styles.rackChip}
              onClick={() => navigate(`/results/${encodeURIComponent(p.member.rack_id)}/ports`)}
              title={`Open ${p.member.label}`}
            >
              <span className={styles.rackChipPos}>#{p.member.position}</span>
              <span className={styles.rackChipLabel}>{p.member.label}</span>
              <code className={styles.rackChipId}>{p.member.rack_id}</code>
            </button>
          ))}
        </div>

        {/* Inter-rack connections — the cables that cross between racks. Most
            cabling stays inside each rack; only these few uplinks span racks. */}
        {links.length > 0 && (
          <div className={styles.linksPanel}>
            <div className={styles.linksHead}>
              <span className={styles.linksTitle}>Inter-rack connections</span>
              <span className={styles.linksCount}>{links.length} cross-rack cable{links.length === 1 ? '' : 's'}</span>
            </div>
            <div className={styles.linksList}>
              {links.map((l, i) => (
                <div key={l.cable_id || i} className={styles.linkRow}>
                  <span className={`${styles.cableDot} ${l.cable_type === 'fiber' ? styles.dotFiber : styles.dotDac}`} />
                  <span className={styles.linkRole}>{l.role || 'Uplink'}</span>
                  <span className={styles.linkEnd}>
                    <b>{labelForRack(layout.placed, l.src?.rackId)}</b> · {l.src?.device}
                    <code>{l.src?.port}</code>
                  </span>
                  <span className={styles.linkArrow}>⇄</span>
                  <span className={styles.linkEnd}>
                    <b>{labelForRack(layout.placed, l.dst?.rackId)}</b> · {l.dst?.device}
                    <code>{l.dst?.port}</code>
                  </span>
                  <span className={styles.linkType}>{(l.cable_type || '').toUpperCase()}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function SharedScene({ layout, palette, links = [], selectedByRack, setSelectedByRack }) {
  const { placed, maxChassisU, camDistBound, sceneW, sceneH, floorY, targetY, U_HEIGHT, DEV_WIDTH } = layout;
  const fogNear = Math.max(camDistBound * 1.20, 40);
  const fogFar  = Math.max(camDistBound * 3.0,  150);
  const gridFade = Math.max(camDistBound * 2.2, sceneW * 2.0, 80);

  // Map rackId → its placement so an inter-rack link can find both endpoints.
  const placeById = useMemo(() => {
    const m = {};
    placed.forEach(p => { m[p.member.rack_id] = p; });
    return m;
  }, [placed]);

  return (
    <Canvas
      shadows={false}
      camera={{ position: [0, 0, camDistBound], fov: 42, near: 0.1, far: 400 }}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      dpr={[1, 2]}
      onPointerMissed={() => setSelectedByRack({})}
      style={{ touchAction: 'none' }}
    >
      <color attach="background" args={[palette.bg]} />
      <fog  attach="fog"        args={[palette.fog, fogNear, fogFar]} />
      <Environment preset={palette.environment} background={false} environmentIntensity={palette.envIntensity} />
      <CameraRig sceneW={sceneW} sceneH={sceneH} targetY={targetY} />
      <SceneLights chassisU={maxChassisU} sceneWidth={sceneW} ambientBoost={palette.ambientBoost} />
      <SceneFloor chassisU={maxChassisU} fadeDistance={gridFade} palette={palette} />
      {placed.map((p) => (
        <RackBundle
          key={p.member.rack_id}
          topo={p.topo}
          xOffset={p.xOffset}
          floorY={floorY}
          palette={palette}
          selected={selectedByRack[p.member.rack_id] || null}
          setSelected={(sel) =>
            setSelectedByRack(prev => ({ ...prev, [p.member.rack_id]: sel }))
          }
        />
      ))}
      <InterRackCables
        links={links}
        placeById={placeById}
        floorY={floorY}
        U_HEIGHT={U_HEIGHT}
        DEV_WIDTH={DEV_WIDTH}
        palette={palette}
      />
      <OrbitControls
        target={[0, targetY, 0]}
        enablePan
        enableDamping
        dampingFactor={0.08}
        minDistance={4}
        maxDistance={Math.max(120, camDistBound * 2.5)}
        minPolarAngle={0.25}
        maxPolarAngle={Math.PI - 0.25}
        makeDefault
      />
    </Canvas>
  );
}

// CameraRig — runs inside <Canvas> so it has access to the real canvas
// dimensions via useThree(). Computes the smallest camera distance that
// still fits both sceneW and sceneH given the *actual* canvas aspect,
// then writes the camera position once on mount + whenever the canvas
// resizes. Without this we'd use a guessed aspect and either over-pull
// (racks tiny) or under-pull (racks clipped at the sides).
function CameraRig({ sceneW, sceneH, targetY = 0 }) {
  const { camera, size } = useThree();
  const fovRad = (42 * Math.PI) / 180;
  const tanHalf = Math.tan(fovRad / 2);
  const aspect = size.height > 0 ? size.width / size.height : 1.0;
  const distH = (sceneH * 1.10) / (2 * tanHalf);
  const distW = (sceneW * 1.10) / (2 * tanHalf * aspect);
  const camDist = Math.max(8, distH, distW);

  useEffect(() => {
    camera.position.set(camDist * 0.34, targetY + camDist * 0.10, camDist * 0.94);
    camera.lookAt(0, targetY, 0);
    camera.updateProjectionMatrix();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camDist, sceneW, sceneH, targetY]);

  return null;
}

function SceneLights({ chassisU, sceneWidth, ambientBoost = 1 }) {
  const topY = chassisU * 0.42 / 2 + 1.2;
  const half = sceneWidth / 2;
  // Per-rack point fills along the row so each rack is lit consistently
  // even when sceneWidth is large (e.g. 4-5 racks).
  const fillCount = Math.max(2, Math.ceil(sceneWidth / 4));
  const fills = [];
  for (let i = 0; i < fillCount; i++) {
    const t = fillCount === 1 ? 0.5 : i / (fillCount - 1);
    const x = -half + t * sceneWidth;
    fills.push(
      <pointLight key={i} position={[x, 1.2, 4]} intensity={0.55}
                  color="#f9f9fb" distance={10} />
    );
  }
  return (
    <>
      <ambientLight intensity={1.15 * ambientBoost} />
      <directionalLight position={[ half + 4, 8,  6]} intensity={1.1} color="#f8f8f8" />
      <directionalLight position={[-half - 4, 8,  6]} intensity={1.1} color="#f8f8f8" />
      {/* Wide overhead spot — covers the full row from above */}
      <spotLight
        position={[0, topY + 4, 2.6]}
        angle={Math.min(1.2, Math.atan2(half + 2, topY + 4))}
        penumbra={0.55}
        intensity={2.6}
        distance={Math.max(40, sceneWidth * 1.6)}
        color="#f9f9f9"
      />
      {fills}
      <pointLight position={[ 0, topY - 0.5, -4.2]} intensity={1.0} color="#000000" distance={Math.max(20, sceneWidth)} />
      <pointLight position={[ 0, -topY + 2, -2.8]} intensity={0.5} color="#1a1c1d" distance={Math.max(20, sceneWidth)} />
    </>
  );
}

function SceneFloor({ chassisU, fadeDistance = 60, palette }) {
  const y = -chassisU * 0.42 / 2 - 0.4;
  const plane = Math.max(120, fadeDistance * 2.5);
  const pal = palette;
  return (
    <group position={[0, y, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[plane, plane]} />
        <meshStandardMaterial color={pal.floor} metalness={0.5} roughness={0.65}
                              transparent opacity={pal.floorOpacity} />
      </mesh>
      <Grid
        position={[0, 0.003, 0]}
        args={[plane, plane]}
        cellSize={0.5}
        cellThickness={0.7}
        cellColor={pal.gridCell}
        sectionSize={3}
        sectionThickness={1.3}
        sectionColor={pal.gridSection}
        fadeDistance={fadeDistance}
        fadeStrength={1.3}
        infiniteGrid
        followCamera={false}
      />
    </group>
  );
}

// Draws the synthesized rack-to-rack uplinks as arcing overhead cables between
// the tops of the two racks — the visible "connection between racks". Each
// rack's own intra-rack cabling is drawn by its RackBundle; these are only the
// few links that cross. Fiber = amber, DAC/copper = cyan.
function InterRackCables({ links, placeById, floorY, U_HEIGHT, DEV_WIDTH, palette }) {
  const cables = useMemo(() => {
    if (!links?.length) return [];
    const hw = (DEV_WIDTH || 1) * 0.42;
    // Per-pair index so multiple cables between the same two racks fan out
    // instead of overlapping into one line.
    const pairSeen = {};
    const out = [];
    links.forEach((lnk, i) => {
      const a = placeById[lnk.src?.rackId];
      const b = placeById[lnk.dst?.rackId];
      if (!a || !b) return;
      const pairKey = [lnk.src.rackId, lnk.dst.rackId].sort().join('|');
      const k = pairSeen[pairKey] = (pairSeen[pairKey] ?? -1) + 1;

      const leftIsA = a.xOffset <= b.xOffset;
      const L = leftIsA ? a : b, R = leftIsA ? b : a;
      const topL = floorY + 0.4 + (L.chassisU || 1) * U_HEIGHT;
      const topR = floorY + 0.4 + (R.chassisU || 1) * U_HEIGHT;

      const lift = 0.55 + (k % 3) * 0.30;
      const z    = 0.30 + (k % 3) * 0.14;
      const start = [L.xOffset + hw, topL + 0.05, z];
      const end   = [R.xOffset - hw, topR + 0.05, z];
      const mid   = [(start[0] + end[0]) / 2, Math.max(topL, topR) + lift, z + 0.12];

      const pts = [];
      const N = 26;
      for (let t = 0; t <= N; t++) {
        const u = t / N, iu = 1 - u;
        pts.push([
          iu * iu * start[0] + 2 * iu * u * mid[0] + u * u * end[0],
          iu * iu * start[1] + 2 * iu * u * mid[1] + u * u * end[1],
          iu * iu * start[2] + 2 * iu * u * mid[2] + u * u * end[2],
        ]);
      }
      const color = lnk.cable_type === 'fiber' ? '#f2c94c' : '#38bdf8';
      out.push({ key: lnk.cable_id || `irl-${i}`, pts, color });
    });
    return out;
  }, [links, placeById, floorY, U_HEIGHT, DEV_WIDTH]);

  if (!cables.length) return null;
  return (
    <group>
      {cables.map(c => (
        <group key={c.key}>
          <Line points={c.pts} color={c.color} lineWidth={2.6} transparent opacity={0.96} />
          <mesh position={c.pts[0]}>
            <sphereGeometry args={[0.05, 12, 12]} />
            <meshStandardMaterial color={c.color} emissive={c.color} emissiveIntensity={0.6} />
          </mesh>
          <mesh position={c.pts[c.pts.length - 1]}>
            <sphereGeometry args={[0.05, 12, 12]} />
            <meshStandardMaterial color={c.color} emissive={c.color} emissiveIntensity={0.6} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Header({ onBack, title, extra }) {
  return (
    <header className={styles.header}>
      <button className={styles.back} onClick={onBack} aria-label="Back">←</button>
      <h2>{title}</h2>
      {extra}
    </header>
  );
}
