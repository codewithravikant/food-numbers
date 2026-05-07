'use client';

import { useEffect, useMemo, useState } from 'react';
import { signOut } from 'next-auth/react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { PressRevealPassword } from '@/components/ui/press-reveal-password';
import { toast } from '@/hooks/use-toast';

const OAUTH_DELETE_CONFIRM_PHRASE = 'DELETE';

type AccountSnapshot = {
  email: string;
  hasPassword: boolean;
};

export function DeleteProfileCard() {
  const [deleting, setDeleting] = useState(false);
  const [open, setOpen] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [confirmPhrase, setConfirmPhrase] = useState('');
  const [account, setAccount] = useState<AccountSnapshot | null>(null);
  const [accountLoading, setAccountLoading] = useState(false);

  useEffect(() => {
    if (!open || account) return;
    setAccountLoading(true);
    fetch('/api/account')
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to load account details');
        return (await res.json()) as AccountSnapshot;
      })
      .then((data) => setAccount(data))
      .catch((err) =>
        toast({
          title: 'Could not load account details',
          description: err instanceof Error ? err.message : undefined,
          variant: 'destructive',
        })
      )
      .finally(() => setAccountLoading(false));
  }, [open, account, toast]);

  const emailMatches = useMemo(() => {
    if (!account?.email) return false;
    return confirmEmail.trim().toLowerCase() === account.email.trim().toLowerCase();
  }, [account?.email, confirmEmail]);

  const canDelete = useMemo(() => {
    if (!account || !emailMatches || deleting || accountLoading) return false;
    if (account.hasPassword) return currentPassword.trim().length > 0;
    return confirmPhrase.trim().toUpperCase() === OAUTH_DELETE_CONFIRM_PHRASE;
  }, [account, emailMatches, deleting, accountLoading, currentPassword, confirmPhrase]);

  const resetDialogState = () => {
    setConfirmEmail('');
    setCurrentPassword('');
    setConfirmPhrase('');
  };

  const handleDelete = async () => {
    if (!account) return;

    setDeleting(true);
    try {
      const payload = account.hasPassword
        ? { email: confirmEmail.trim(), currentPassword }
        : { email: confirmEmail.trim(), confirmPhrase: confirmPhrase.trim() };
      const res = await fetch('/api/account', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to delete profile');
      }
      toast({ title: 'Profile deleted', description: 'Your account has been removed.', variant: 'success' });
      await signOut({ callbackUrl: '/' });
    } catch (e) {
      toast({
        title: 'Could not delete profile',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <Card className="border-red-500/25 bg-background/60 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="text-base text-red-200">Danger zone</CardTitle>
          <CardDescription>Permanently delete your account and all data.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            type="button"
            onClick={() => setOpen(true)}
            loading={deleting}
            className="w-full bg-red-600 hover:bg-red-700 text-white"
          >
            Delete profile
          </Button>
        </CardContent>
      </Card>

      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) resetDialogState();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-red-200">Confirm profile deletion</DialogTitle>
            <DialogDescription>
              This action permanently deletes your account and all associated data. This cannot be undone.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="delete-confirm-email" className="text-sm font-medium">
                Confirm your email
              </label>
              <Input
                id="delete-confirm-email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={confirmEmail}
                onChange={(e) => setConfirmEmail(e.target.value)}
                disabled={accountLoading || deleting}
              />
              <p className="text-xs text-muted-foreground">
                Type the email for this account to continue.
              </p>
            </div>

            {account?.hasPassword ? (
              <div className="space-y-1.5">
                <label htmlFor="delete-current-password" className="text-sm font-medium">
                  Current password
                </label>
                <PressRevealPassword
                  id="delete-current-password"
                  label="current password"
                  autoComplete="current-password"
                  placeholder="Enter your current password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  disabled={accountLoading || deleting}
                />
              </div>
            ) : (
              <div className="space-y-1.5">
                <label htmlFor="delete-confirm-phrase" className="text-sm font-medium">
                  Type {OAUTH_DELETE_CONFIRM_PHRASE} to confirm
                </label>
                <Input
                  id="delete-confirm-phrase"
                  type="text"
                  autoComplete="off"
                  placeholder={OAUTH_DELETE_CONFIRM_PHRASE}
                  value={confirmPhrase}
                  onChange={(e) => setConfirmPhrase(e.target.value)}
                  disabled={accountLoading || deleting}
                />
                <p className="text-xs text-muted-foreground">
                  This account has no password. Phrase confirmation is required to delete it.
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setOpen(false);
                resetDialogState();
              }}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleDelete}
              loading={deleting}
              disabled={!canDelete}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              Permanently delete profile
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

