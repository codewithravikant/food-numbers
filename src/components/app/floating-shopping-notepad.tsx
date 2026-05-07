'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Loader2, Minimize2, ShoppingBag, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';

const STORAGE_KEY = 'shopping-notepad-open';
const ENABLED_KEY = 'shopping-notepad-enabled';
const SHOPPING_LIST_UPDATED_EVENT = 'shopping-list-updated';

type ShoppingItem = {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  checked: boolean;
};

function emitShoppingListUpdated() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(SHOPPING_LIST_UPDATED_EVENT));
}

export function FloatingShoppingNotepad() {
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [newName, setNewName] = useState('');
  const [newQuantity, setNewQuantity] = useState('1');
  const [newUnit, setNewUnit] = useState('item');
  const [adding, setAdding] = useState(false);
  const previousCountRef = useRef(0);

  const setOpenWithPersistence = useCallback((next: boolean) => {
    setOpen(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
    }
  }, []);

  const refreshItems = useCallback(async () => {
    try {
      const response = await fetch('/api/shopping-list', { cache: 'no-store' });
      if (!response.ok) throw new Error('Could not load shopping list');
      const payload = await response.json().catch(() => ({ items: [] as ShoppingItem[] }));
      const nextItems = Array.isArray(payload.items) ? (payload.items as ShoppingItem[]) : [];
      const previousCount = previousCountRef.current;
      previousCountRef.current = nextItems.length;
      setItems(nextItems);
      if (previousCount === 0 && nextItems.length > 0) {
        setOpenWithPersistence(true);
      }
    } catch (error) {
      toast({
        title: 'Shopping list unavailable',
        description: (error as Error).message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [setOpenWithPersistence]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const persisted = window.localStorage.getItem(STORAGE_KEY);
    const enabledValue = window.localStorage.getItem(ENABLED_KEY);
    if (persisted === '0') setOpen(false);
    if (persisted === '1') setOpen(true);
    if (enabledValue === '1') {
      setEnabled(true);
      void refreshItems();
    } else {
      setLoading(false);
    }

    const handleUpdate = () => {
      if (!enabled && window.localStorage.getItem(ENABLED_KEY) === '1') {
        setEnabled(true);
      }
      void refreshItems();
    };

    window.addEventListener(SHOPPING_LIST_UPDATED_EVENT, handleUpdate);
    window.addEventListener('focus', handleUpdate);
    return () => {
      window.removeEventListener(SHOPPING_LIST_UPDATED_EVENT, handleUpdate);
      window.removeEventListener('focus', handleUpdate);
    };
  }, [enabled, refreshItems]);

  const allChecked = useMemo(
    () => items.length > 0 && items.every((item) => item.checked),
    [items]
  );

  const toggleChecked = async (item: ShoppingItem, checked: boolean) => {
    setItems((current) => current.map((row) => (row.id === item.id ? { ...row, checked } : row)));
    try {
      const response = await fetch(`/api/shopping-list/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checked }),
      });
      if (!response.ok) throw new Error('Could not update item');
      emitShoppingListUpdated();
    } catch (error) {
      setItems((current) => current.map((row) => (row.id === item.id ? { ...row, checked: item.checked } : row)));
      toast({
        title: 'Update failed',
        description: (error as Error).message,
        variant: 'destructive',
      });
    }
  };

  const discardCompleted = async () => {
    const completedItems = items.filter((item) => item.checked);
    if (completedItems.length === 0) return;
    setBusy(true);
    try {
      const results = await Promise.allSettled(
        completedItems.map(async (item) => {
          const response = await fetch(`/api/shopping-list/${item.id}`, { method: 'DELETE' });
          if (!response.ok) throw new Error('Could not discard completed list');
        })
      );
      const failedDeletes = results.filter((result) => result.status === 'rejected').length;
      if (failedDeletes > 0) {
        throw new Error(`Could not discard ${failedDeletes} completed item(s)`);
      }
      toast({
        title: 'Thank you',
        description: 'Completed shopping list discarded.',
        variant: 'success',
      });
      await refreshItems();
      setOpenWithPersistence(false);
      emitShoppingListUpdated();
    } catch (error) {
      toast({
        title: 'Discard failed',
        description: (error as Error).message,
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  const addManualItem = async () => {
    const name = newName.trim();
    const quantity = Number(newQuantity);
    if (!name) {
      toast({ title: 'Item name is required', variant: 'destructive' });
      return;
    }
    if (!Number.isFinite(quantity) || quantity < 0) {
      toast({ title: 'Quantity must be 0 or more', variant: 'destructive' });
      return;
    }

    setAdding(true);
    try {
      const response = await fetch('/api/shopping-list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          quantity,
          unit: newUnit.trim() || 'item',
          category: /ready|takeaway|take-out|restaurant/.test(name.toLowerCase())
            ? 'Ready meals'
            : undefined,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Could not add item');

      if (typeof window !== 'undefined') {
        window.localStorage.setItem(ENABLED_KEY, '1');
      }
      setEnabled(true);
      setNewName('');
      setNewQuantity('1');
      setNewUnit('item');
      toast({ title: 'Added to shopping list', variant: 'success' });
      emitShoppingListUpdated();
      await refreshItems();
      setOpenWithPersistence(true);
    } catch (error) {
      toast({
        title: 'Add failed',
        description: (error as Error).message,
        variant: 'destructive',
      });
    } finally {
      setAdding(false);
    }
  };

  if (!enabled) return null;
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpenWithPersistence(true)}
        className={cn(
          'fixed bottom-40 right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full border border-border/70 bg-background/95 shadow-lg backdrop-blur transition-all hover:scale-105 active:scale-95',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          'sm:right-8 md:bottom-24 md:right-8'
        )}
        aria-label="Open shopping notepad"
      >
        <ShoppingBag className="h-6 w-6 text-primary" />
      </button>
    );
  }

  return (
    <aside
      className={cn(
        'fixed bottom-40 right-4 z-40 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-border/70 bg-background/95 p-3 shadow-2xl backdrop-blur',
        'sm:right-8 md:bottom-24 md:right-8'
      )}
      aria-label="Floating shopping notepad"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">Shopping bag</p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2"
          onClick={() => setOpenWithPersistence(false)}
          aria-label="Minimize shopping notepad"
        >
          <Minimize2 className="h-4 w-4" />
        </Button>
      </div>

      {loading ? (
        <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading shopping list...
        </div>
      ) : allChecked ? (
        <div className="mt-3 space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
          <p className="text-sm font-medium text-primary">Thank you! You completed everything.</p>
          <Button
            type="button"
            size="sm"
            className="w-full gap-2"
            onClick={discardCompleted}
            disabled={busy}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            Discard list
          </Button>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="rounded-md border border-border/60 p-2 space-y-2">
            <p className="text-[11px] text-muted-foreground">
              Add ingredients for meal prep or ready-food items you plan to buy.
            </p>
            <div className="grid grid-cols-[1fr_auto_auto_auto] gap-1.5">
              <input
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder="Ingredient or ready meal"
                className="h-8 rounded border border-border bg-background px-2 text-xs"
              />
              <input
                value={newQuantity}
                onChange={(event) => setNewQuantity(event.target.value)}
                inputMode="decimal"
                className="h-8 w-14 rounded border border-border bg-background px-2 text-xs"
              />
              <input
                value={newUnit}
                onChange={(event) => setNewUnit(event.target.value)}
                className="h-8 w-14 rounded border border-border bg-background px-2 text-xs"
              />
              <Button
                type="button"
                size="sm"
                className="h-8 px-2 text-[11px]"
                onClick={() => void addManualItem()}
                disabled={adding}
              >
                {adding ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Add'}
              </Button>
            </div>
          </div>
          {items.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Your list is empty. Add items above to start planning groceries.
            </p>
          ) : (
            <ul className="max-h-64 space-y-2 overflow-y-auto pr-1">
              {items.map((item) => (
                <li key={item.id} className="flex items-start gap-2 rounded-md border border-border/60 px-2 py-1.5">
                  <input
                    type="checkbox"
                    checked={item.checked}
                    onChange={(event) => void toggleChecked(item, event.target.checked)}
                    aria-label={`Mark ${item.name} as completed`}
                    className="mt-0.5"
                  />
                  <div className="min-w-0 flex-1">
                    <p className={cn('text-xs', item.checked && 'line-through text-muted-foreground')}>
                      {item.quantity} {item.unit} {item.name}
                    </p>
                  </div>
                  {item.checked ? <Check className="mt-0.5 h-4 w-4 text-primary" /> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </aside>
  );
}
