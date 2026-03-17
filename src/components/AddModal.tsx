import { useState } from "react";
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
  onSaveProfile: (name: string, link: string) => Promise<void>;
  onImportSubscription: (url: string) => Promise<void>;
}

function AddModal({
  isOpen,
  onClose,
  onSaveProfile,
  onImportSubscription,
}: AddModalProps) {
  const [name, setName] = useState("");
  const [inputLink, setInputLink] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const handleProcess = async () => {
    const link = inputLink.trim();
    if (!link) return;
    setIsLoading(true);
    setErrorMsg("");

    try {
      const isSubscription = /^https?:\/\//i.test(link);
      const isJsonConfig = /^\s*\{/.test(link);

      if (isSubscription) {
        await onImportSubscription(link);
        handleClose();
        return;
      }

      const finalName = name || (isJsonConfig ? "Custom Sing-box" : "New Profile");
      await onSaveProfile(finalName, link);
      handleClose();
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
          <DialogTitle>Add Profile / Subscription</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="config-link">
              Config Link, Subscription URL, or Clash YAML
            </Label>
            <Textarea
              id="config-link"
              value={inputLink}
              onChange={(e) => setInputLink(e.target.value)}
              placeholder="Paste vless://... OR https://example.com/sub OR Clash YAML"
              className="font-mono text-xs resize-none"
              rows={3}
            />
          </div>

          {!inputLink.trim().startsWith("http") && (
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
              : inputLink.trim().startsWith("http")
              ? "Import Sub"
              : "Add Profile"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default AddModal;
