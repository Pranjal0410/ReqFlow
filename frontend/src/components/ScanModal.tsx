import React from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  StyleSheet,
} from "react-native";
import { colors } from "../theme/colors";
import { radius, shadow } from "../theme/tokens";
import Icon from "./Icon";

interface Props {
  visible: boolean;
  onClose: () => void;
  onScan: (path: string) => void;
  scanning: boolean;
  error?: string | null;
}

export default function ScanModal({ visible, onClose, onScan, scanning, error }: Props) {
  const [projectPath, setProjectPath] = React.useState("");

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
          />

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