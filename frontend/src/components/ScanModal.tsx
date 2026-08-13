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

export type ScanStage = "reading" | "analyzing" | null;

interface Props {
  visible: boolean;
  onClose: () => void;
  onScan: (path: string) => void;
  scanning: boolean;
  error?: string | null;
  stage: ScanStage;
  // how many route files the backend actually read, null until it says
  filesFound: number | null;
}

export default function ScanModal({
  visible,
  onClose,
  onScan,
  scanning,
  error,
  stage,
  filesFound,
}: Props) {
  const [projectPath, setProjectPath] = React.useState("");

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

          {scanning && (
            <View style={styles.progress}>
              {step(
                stage === "analyzing",
                stage === "reading",
                filesFound === null
                  ? "Reading route files"
                  : `Read ${filesFound} route file${filesFound === 1 ? "" : "s"}`
              )}
              {step(false, stage === "analyzing", "Extracting endpoints")}
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
              style={[styles.scanBtn, scanning && styles.scanBtnDisabled]}
              onPress={() => onScan(projectPath)}
              disabled={scanning || !projectPath.trim()}
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