import React from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Pressable,
  Modal,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { colors } from "../theme/colors";
import { radius, shadow, transition } from "../theme/tokens";
import Icon from "./Icon";
import { probeProject, DetectedPort } from "../services/api";

interface Props {
  visible: boolean;
  onClose: () => void;
  onScan: (path: string, baseUrl: string) => void;
  scanning: boolean;
  error?: string | null;
  recent: string[];
}

export default function ScanModal({ visible, onClose, onScan, scanning, error, recent }: Props) {
  const [projectPath, setProjectPath] = React.useState("");

  // The desktop wrapper exposes exactly one method to this window: open a folder
  // dialog. In a browser there is no file system to open, so the field stays a
  // field and nothing pretends otherwise.
  const desktop = (globalThis as any).reqflowDesktop;
  const canBrowse = typeof desktop?.chooseProjectFolder === "function";

  const browse = async () => {
    try {
      const chosen = await desktop.chooseProjectFolder();
      if (chosen) setProjectPath(chosen);
    } catch {
      // a cancelled or failed dialog leaves the field exactly as it was, which
      // is what someone who changed their mind expects
    }
  };

  // In the desktop app, Scan Project opens the file browser — because that is
  // what pressing it means. Typing an absolute path is what you do when the app
  // has no way to open a window onto the disk; this one does, and on macOS
  // choosing a folder in that window is also what grants permission to write
  // into it.
  //
  // The dialog opens over the panel rather than replacing it: cancelling leaves
  // the field, the recent list and the base URL exactly where they were, so
  // changing your mind costs nothing.
  const openedOnce = React.useRef(false);
  React.useEffect(() => {
    if (!visible) {
      openedOnce.current = false;
      return;
    }
    if (openedOnce.current || !canBrowse || projectPath.trim()) return;
    openedOnce.current = true;
    browse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, canBrowse]);
  const [baseUrl, setBaseUrl] = React.useState("");
  // set once the user edits the field, so a later probe cannot overwrite them
  const [baseUrlTouched, setBaseUrlTouched] = React.useState(false);

  const [filesFound, setFilesFound] = React.useState<number | null>(null);
  const [filesTotal, setFilesTotal] = React.useState<number | null>(null);
  const [detected, setDetected] = React.useState<DetectedPort | null>(null);
  const [probing, setProbing] = React.useState(false);
  // a folder with thousands of files takes the better part of a minute to walk,
  // and "reading folder..." on its own is indistinguishable from a hang
  const [probeElapsed, setProbeElapsed] = React.useState(0);
  const [probeError, setProbeError] = React.useState<string | null>(null);

  // the path is read as it is typed rather than on submit, so the file count is
  // feedback that the folder is right, and the port it finds fills the base url
  // in before the user has to think about it
  React.useEffect(() => {
    const path = projectPath.trim();
    if (!visible || !path) {
      setFilesFound(null);
      setFilesTotal(null);
      setDetected(null);
      setProbeError(null);
      return;
    }

    let cancelled = false;
    setProbing(true);
    const id = setTimeout(async () => {
      try {
        const result = await probeProject(path);
        if (cancelled) return;
        setFilesFound(result.filesScanned);
        setFilesTotal(result.truncated ? result.filesFound : null);
        setDetected(result.detectedPort);
        setProbeError(null);
        if (result.detectedPort && !baseUrlTouched) {
          setBaseUrl(`http://localhost:${result.detectedPort.port}`);
        }
      } catch (err: any) {
        if (cancelled) return;
        setFilesFound(null);
        setFilesTotal(null);
        setDetected(null);
        // a dead backend used to read as a bad path, which points at the one
        // thing that was fine
        setProbeError(
          err?.response?.data?.error ||
            (err?.response
              ? "could not read that folder"
              : "ReqFlow's backend is not answering on port 4000. Start it with npm run dev.")
        );
      } finally {
        if (!cancelled) setProbing(false);
      }
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [projectPath, visible, baseUrlTouched]);

  // a scan waits on Gemini, which can take a while. counting up is the honest
  // way to fill that gap: no invented percentage, just how long it has taken.
  const [elapsed, setElapsed] = React.useState(0);

  React.useEffect(() => {
    if (!probing) {
      setProbeElapsed(0);
      return;
    }
    const start = Date.now();
    const id = setInterval(() => setProbeElapsed(Date.now() - start), 100);
    return () => clearInterval(id);
  }, [probing]);

  React.useEffect(() => {
    if (!scanning) {
      setElapsed(0);
      return;
    }
    const start = Date.now();
    const id = setInterval(() => setElapsed(Date.now() - start), 100);
    return () => clearInterval(id);
  }, [scanning]);

  const step = (done: boolean, active: boolean, label: string) => (
    <View style={styles.step}>
      {done ? (
        <Icon name="check" size={13} color={colors.statusOk} />
      ) : active ? (
        <ActivityIndicator size="small" color={colors.accent} />
      ) : (
        <View style={styles.stepDot} />
      )}
      <Text style={[styles.stepText, (done || active) && styles.stepTextOn]}>{label}</Text>
    </View>
  );

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <Text style={styles.title}>Scan Project</Text>
          <Text style={styles.subtitle}>
            {canBrowse
              ? "pick a Node.js project folder, or paste a path"
              : "enter the path to a Node.js project folder"}
          </Text>

          <View style={styles.pathRow}>
            <TextInput
              style={[styles.input, styles.pathInput]}
              placeholder="/Users/you/projects/my-api"
              placeholderTextColor={colors.textDim}
              value={projectPath}
              onChangeText={setProjectPath}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!scanning}
            />
            {/* Only in the desktop app, because only there is there a file
                system to open. On macOS this is also what makes writing work:
                choosing a folder in a real dialog is the act that grants the app
                access to it, which typing the same path never does. */}
            {canBrowse && (
              <Pressable
                disabled={scanning}
                onPress={browse}
                style={({ hovered }: any) => [
                  styles.browseBtn,
                  hovered && styles.browseBtnHover,
                  scanning && styles.browseBtnDisabled,
                ]}
              >
                <Text style={styles.browseText}>Browse…</Text>
              </Pressable>
            )}
          </View>

          {/* the path is long and typed from memory, and most scans are of a
              folder already scanned once */}
          {!projectPath && recent.length > 0 && (
            <View style={styles.recentBox}>
              {recent.map((p) => (
                <Pressable
                  key={p}
                  style={({ hovered }: any) => [styles.recent, hovered && styles.recentHover]}
                  onPress={() => setProjectPath(p)}
                >
                  <Text style={styles.recentText} numberOfLines={1}>
                    {p.split("/").filter(Boolean).slice(-2).join("/")}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}

          {probing && (
            <Text style={styles.probe}>
              reading folder... {(probeElapsed / 1000).toFixed(1)}s
              {probeElapsed > 6000 ? "  (a big folder takes a while, or edit the path to stop)" : ""}
            </Text>
          )}
          {!probing && probeError && <Text style={styles.probeBad}>{probeError}</Text>}
          {!probing && filesFound !== null && filesTotal === null && (
            <Text style={styles.probe}>
              {filesFound} route file{filesFound === 1 ? "" : "s"} found
            </Text>
          )}

          {/* a partial scan read as a complete one would be worse than no scan,
              so the numbers are both shown */}
          {!probing && filesTotal !== null && (
            <Text style={styles.probeBad}>
              {filesTotal} route files here, only the first {filesFound} can be scanned. Point at
              one project rather than a folder of them.
            </Text>
          )}

          {/* required, because a scan that leaves this at a default points
              every route it just found at the wrong server */}
          <Text style={styles.label}>Base URL of the running server</Text>
          <TextInput
            style={styles.input}
            placeholder="http://localhost:3000"
            placeholderTextColor={colors.textDim}
            value={baseUrl}
            onChangeText={(v) => {
              setBaseUrlTouched(true);
              setBaseUrl(v);
            }}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!scanning}
          />
          {detected && !baseUrlTouched && (
            <Text style={styles.probe}>port {detected.port} from {detected.source}</Text>
          )}

          {scanning && (
            <View style={styles.progress}>
              {step(true, false, `Read ${filesFound ?? 0} route file${filesFound === 1 ? "" : "s"}`)}
              {step(false, true, "Extracting endpoints")}
              <Text style={styles.elapsed}>{(elapsed / 1000).toFixed(1)}s</Text>
            </View>
          )}

          {error && (
            <View style={styles.error}>
              <Icon name="alert" size={15} color={colors.statusErr} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <View style={styles.buttons}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.scanBtn,
                (scanning || !projectPath.trim() || !baseUrl.trim()) && styles.scanBtnDisabled,
              ]}
              onPress={() => onScan(projectPath.trim(), baseUrl.trim())}
              disabled={scanning || !projectPath.trim() || !baseUrl.trim()}
            >
              <Text style={styles.scanText}>
                {scanning ? "Scanning..." : "Scan"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  pathRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  pathInput: { flex: 1 },
  browseBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 9,
    ...transition("background-color"),
  },
  browseBtnHover: { backgroundColor: colors.hover },
  browseBtnDisabled: { opacity: 0.45 },
  browseText: { color: colors.textMuted, fontSize: 12 },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "center",
    alignItems: "center",
  },
  modal: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: 24,
    width: "85%",
    maxWidth: 400,
    ...shadow.md,
  },
  title: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "500",
    marginBottom: 4,
  },
  subtitle: {
    color: colors.textDim,
    fontSize: 13,
    marginBottom: 16,
  },
  input: {
    backgroundColor: colors.surfaceLight,
    color: colors.text,
    borderRadius: radius.md,
    padding: 12,
    fontSize: 13,
    fontFamily: "monospace",
    marginBottom: 16,
    ...shadow.sm,
  },
  recentBox: {
    marginTop: -10,
    marginBottom: 12,
    gap: 4,
  },
  recent: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceLight,
  },
  recentHover: {
    backgroundColor: colors.hover,
  },
  recentText: {
    color: colors.textDim,
    fontSize: 11,
    fontFamily: "monospace",
  },
  label: {
    color: colors.textDim,
    fontSize: 11,
    fontWeight: "500",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 6,
  },
  probe: {
    color: colors.textDim,
    fontSize: 11,
    fontFamily: "monospace",
    marginTop: -10,
    marginBottom: 12,
  },
  probeBad: {
    color: colors.statusErr,
    fontSize: 11,
    marginTop: -10,
    marginBottom: 12,
  },
  progress: {
    backgroundColor: colors.surfaceLight,
    borderRadius: radius.md,
    padding: 12,
    marginBottom: 14,
    gap: 8,
  },
  step: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 20,
  },
  stepDot: {
    width: 13,
    height: 13,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: colors.border,
  },
  stepText: {
    flex: 1,
    color: colors.textDim,
    fontSize: 12,
  },
  stepTextOn: {
    color: colors.text,
  },
  elapsed: {
    color: colors.textDim,
    fontSize: 11,
    fontFamily: "monospace",
    textAlign: "right",
  },
  error: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: "rgba(248, 113, 113, 0.10)",
    borderLeftWidth: 3,
    borderLeftColor: colors.statusErr,
    borderRadius: radius.sm,
    padding: 10,
    marginBottom: 14,
  },
  errorText: {
    flex: 1,
    color: colors.text,
    fontSize: 12,
    lineHeight: 18,
  },
  buttons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
  },
  cancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  cancelText: {
    color: colors.textDim,
    fontSize: 14,
  },
  scanBtn: {
    backgroundColor: colors.accent,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: radius.md,
    ...shadow.sm,
  },
  scanBtnDisabled: {
    opacity: 0.5,
  },
  scanText: {
    color: colors.bg,
    fontWeight: "500",
    fontSize: 14,
  },
});