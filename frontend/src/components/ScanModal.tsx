import React from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { colors } from "../theme/colors";
import { radius, shadow } from "../theme/tokens";
import Icon from "./Icon";
import { probeProject, DetectedPort } from "../services/api";

interface Props {
  visible: boolean;
  onClose: () => void;
  onScan: (path: string, baseUrl: string) => void;
  scanning: boolean;
  error?: string | null;
}

export default function ScanModal({ visible, onClose, onScan, scanning, error }: Props) {
  const [projectPath, setProjectPath] = React.useState("");
  const [baseUrl, setBaseUrl] = React.useState("");
  // set once the user edits the field, so a later probe cannot overwrite them
  const [baseUrlTouched, setBaseUrlTouched] = React.useState(false);

  const [filesFound, setFilesFound] = React.useState<number | null>(null);
  const [detected, setDetected] = React.useState<DetectedPort | null>(null);
  const [probing, setProbing] = React.useState(false);
  const [probeError, setProbeError] = React.useState<string | null>(null);

  // the path is read as it is typed rather than on submit, so the file count is
  // feedback that the folder is right, and the port it finds fills the base url
  // in before the user has to think about it
  React.useEffect(() => {
    const path = projectPath.trim();
    if (!visible || !path) {
      setFilesFound(null);
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
        setDetected(result.detectedPort);
        setProbeError(null);
        if (result.detectedPort && !baseUrlTouched) {
          setBaseUrl(`http://localhost:${result.detectedPort.port}`);
        }
      } catch (err: any) {
        if (cancelled) return;
        setFilesFound(null);
        setDetected(null);
        setProbeError(err?.response?.data?.error || "could not read that folder");
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
            enter the path to a Node.js project folder
          </Text>

          <TextInput
            style={styles.input}
            placeholder="/Users/you/projects/my-api"
            placeholderTextColor={colors.textDim}
            value={projectPath}
            onChangeText={setProjectPath}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!scanning}
          />

          {probing && <Text style={styles.probe}>reading folder...</Text>}
          {!probing && probeError && <Text style={styles.probeBad}>{probeError}</Text>}
          {!probing && filesFound !== null && (
            <Text style={styles.probe}>
              {filesFound} route file{filesFound === 1 ? "" : "s"} found
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