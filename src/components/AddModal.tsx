import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Loader2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

interface AddModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (name: string | null, link: string | null, isReload?: boolean) => void;
}

function AddModal({ isOpen, onClose, onSave }: AddModalProps) {
  const [name, setName] = useState("");
  const [inputLink, setInputLink] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const handleProcess = async () => {
    if (!inputLink) return;
    setIsLoading(true);
    setErrorMsg("");

    try {
      if (inputLink.startsWith("http://") || inputLink.startsWith("https://")) {
        await invoke("import_subscription", { url: inputLink });
        onSave(null, null, true);
        handleClose();
      } else {
        const finalName = name || "New Profile";
        onSave(finalName, inputLink, false);
        handleClose();
      }
    } catch (e) {
      setErrorMsg("Error: " + e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setName("");
    setInputLink("");
    setErrorMsg("");
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Profile</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="config-link">Config Link OR Subscription URL</Label>
            <Textarea
              id="config-link"
              value={inputLink}
              onChange={(e) => setInputLink(e.target.value)}
              placeholder="Paste vless://... OR http://mysite.com/sub"
              className="font-mono text-xs resize-none"
              rows={3}
            />
          </div>

          {!inputLink.startsWith("http") && (
            <div className="grid gap-2">
              <Label htmlFor="profile-name">Profile Name (Optional)</Label>
              <Input
                id="profile-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Server"
              />
            </div>
          )}

          {errorMsg && (
            <div className="text-destructive text-xs p-2 bg-destructive/10 rounded border border-destructive/20">
              {errorMsg}
            </div>
          )}
        </div>

        <DialogFooter className="sm:justify-end gap-2">
          <Button variant="secondary" onClick={handleClose}>
            Cancel
          </Button>
          <Button onClick={handleProcess} disabled={isLoading}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isLoading
              ? "Processing..."
              : inputLink.startsWith("http")
              ? "Import Sub"
              : "Add Profile"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default AddModal;
