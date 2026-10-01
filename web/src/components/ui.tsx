import { LoaderCircle, Plus, Search, X, type LucideIcon } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';
import { api, type ChannelInfo, type RoleInfo, type UserInfo } from '../lib/api';
import { cdn, errorMessage } from '../lib/format';

export function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}

// ------------------------------------------------------------------ toast

type ToastKind = 'ok' | 'error';
const ToastContext = createContext<(message: string, kind?: ToastKind) => void>(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ message: string; kind: ToastKind; id: number } | null>(null);
  const show = useCallback((message: string, kind: ToastKind = 'ok') => setToast({ message, kind, id: Date.now() }), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        role="status"
        className={cx(
          'fixed left-1/2 top-3 z-50 max-w-[calc(100%-32px)] -translate-x-1/2 rounded-lg px-4 py-2 font-semibold text-white shadow-lg transition-all duration-200',
          toast ? 'translate-y-0 opacity-100' : '-translate-y-16 opacity-0',
          toast?.kind === 'error' ? 'bg-danger' : 'bg-ok',
        )}
      >
        {toast?.message}
      </div>
    </ToastContext.Provider>
  );
}

/** Runs an async action with a toast on error (and optional on success). */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
      setBusy(true);
      try {
        const result = await fn();
        if (success) toast(success);
        return result;
      } catch (e) {
        toast(errorMessage(e), 'error');
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );
  return { run, busy };
}

// ---------------------------------------------------------------- layout

export function Card({
  title,
  icon: Icon,
  description,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  icon?: LucideIcon;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx('rounded-xl border border-line bg-surface p-4', className)}>
      {(title || actions) && (
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          {title && (
            <h3 className="flex items-center gap-2 text-base font-semibold">
              {Icon && <Icon className="size-4.5 text-accent" />}
              {title}
            </h3>
          )}
          {actions}
        </div>
      )}
      {description && <p className="mb-2 text-muted">{description}</p>}
      {children}
    </section>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle className={cx('animate-spin text-accent', className ?? 'size-8')} />;
}

export function CenterScreen({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-2 px-4 text-center">
      <Icon className="mb-2 size-11 text-accent" />
      <h2 className="text-xl font-semibold">{title}</h2>
      <div className="text-muted">{children}</div>
    </div>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <h4 className="mb-1.5 mt-4 text-xs font-semibold uppercase tracking-wide text-muted">{children}</h4>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-2 text-sm text-muted">{children}</p>;
}

// --------------------------------------------------------------- buttons

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
const variants: Record<Variant, string> = {
  primary: 'bg-accent text-bg hover:bg-accent-hover',
  secondary: 'bg-blurple text-white hover:brightness-110',
  ghost: 'bg-transparent text-muted hover:bg-surface-3 hover:text-fg',
  danger: 'border border-red-400/40 bg-transparent text-red-400 hover:border-danger hover:bg-danger hover:text-white',
  subtle: 'bg-surface-3 text-fg hover:brightness-110',
};

export function Button({
  variant = 'subtle',
  size = 'md',
  icon: Icon,
  loading,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; icon?: LucideIcon; loading?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || loading}
      className={cx(
        'inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-semibold transition disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3.5 py-2 text-sm',
        variants[variant],
        className,
      )}
    >
      {loading ? <LoaderCircle className="size-4 animate-spin" /> : Icon && <Icon className="size-4" />}
      {children}
    </button>
  );
}

export function IconButton({ icon: Icon, label, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      {...props}
      className={cx('cursor-pointer rounded-md p-1.5 text-muted transition hover:bg-surface-3 hover:text-fg disabled:opacity-40', className)}
    >
      <Icon className="size-4" />
    </button>
  );
}

/** Two-step button. Native confirm() is blocked inside Activities. */
export function ConfirmButton({
  onConfirm,
  confirmLabel = '¿Seguro?',
  children,
  ...props
}: Omit<Parameters<typeof Button>[0], 'onClick'> & { onConfirm: () => void | Promise<void>; confirmLabel?: string }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <Button
      variant="danger"
      size="sm"
      {...props}
      className={cx(armed && '!bg-danger !text-white', props.className)}
      onClick={() => {
        if (!armed) return setArmed(true);
        setArmed(false);
        void onConfirm();
      }}
    >
      {armed ? confirmLabel : children}
    </Button>
  );
}

// ---------------------------------------------------------------- inputs

const inputClass =
  'w-full min-w-0 rounded-lg border border-line bg-bg px-3 py-2 text-fg outline-none placeholder:text-muted/60 focus:border-transparent focus:ring-2 focus:ring-blurple disabled:opacity-50';

export function Field({ label, hint, children }: { label?: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="mt-3 flex flex-col gap-1.5">
      {label && <span className="text-[13px] font-semibold">{label}</span>}
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function TextInput({
  value,
  onChange,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> & { value: string; onChange: (v: string) => void }) {
  return <input type="text" maxLength={100} {...props} value={value} onChange={(e) => onChange(e.target.value)} className={cx(inputClass, props.className)} />;
}

export function NumberInput({
  value,
  min,
  max,
  onChange,
  suffix,
  disabled,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  suffix?: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        min={min}
        max={max}
        disabled={disabled}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const n = Math.round(Number(e.target.value));
          if (e.target.value !== '' && Number.isFinite(n)) onChange(Math.min(Math.max(n, min), max));
        }}
        onBlur={() => setText(String(value))}
        className={inputClass}
      />
      {suffix && <span className="text-muted">{suffix}</span>}
    </div>
  );
}

export function Toggle({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: ReactNode;
  hint?: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className={cx('mt-3 flex items-center justify-between gap-4 border-t border-line pt-3', disabled ? 'opacity-50' : 'cursor-pointer')}>
      <div>
        <div className="text-[13px] font-semibold">{label}</div>
        {hint && <div className="text-xs text-muted">{hint}</div>}
      </div>
      <span className="relative h-6 w-[42px] shrink-0">
        <input type="checkbox" className="peer sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <span className="absolute inset-0 rounded-full bg-[#80848e] transition peer-checked:bg-ok peer-focus-visible:ring-2 peer-focus-visible:ring-blurple" />
        <span className="absolute left-[3px] top-[3px] size-[18px] rounded-full bg-white transition peer-checked:translate-x-[18px]" />
      </span>
    </label>
  );
}

export function ChannelSelect({
  channels,
  type,
  value,
  onChange,
  emptyLabel = '— Ninguno —',
}: {
  channels: ChannelInfo[];
  type: ChannelInfo['type'];
  value: string | null;
  onChange: (v: string | null) => void;
  emptyLabel?: string;
}) {
  const categories = new Map(channels.filter((c) => c.type === 'category').map((c) => [c.id, c.name]));
  const groups = new Map<string, ChannelInfo[]>();
  for (const c of channels.filter((c) => c.type === type)) {
    const key = type === 'category' ? '' : c.parentId ? (categories.get(c.parentId) ?? 'Sin categoría') : 'Sin categoría';
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  const prefix = type === 'voice' ? '🔊 ' : type === 'text' ? '# ' : '';
  return (
    <select className={inputClass} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{emptyLabel}</option>
      {[...groups].map(([group, list]) =>
        group ? (
          <optgroup key={group} label={group}>
            {list.map((c) => (
              <option key={c.id} value={c.id}>
                {prefix + c.name}
              </option>
            ))}
          </optgroup>
        ) : (
          list.map((c) => (
            <option key={c.id} value={c.id}>
              {prefix + c.name}
            </option>
          ))
        ),
      )}
    </select>
  );
}

export function Chip({ children, color, onRemove }: { children: ReactNode; color?: string; onRemove?: () => void }) {
  const c = color && color !== '#000000' ? color : '#99aab5';
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border py-0.5 pl-2.5 pr-1 text-[12.5px]"
      style={{ borderColor: `${c}73`, background: `color-mix(in srgb, ${c} 18%, var(--color-surface-3))` }}
    >
      {children}
      {onRemove ? (
        <button type="button" aria-label="Quitar" onClick={onRemove} className="cursor-pointer rounded-full p-0.5 text-muted hover:text-fg">
          <X className="size-3.5" />
        </button>
      ) : (
        <span className="w-1" />
      )}
    </span>
  );
}

export function RolePicker({ roles, value, onChange }: { roles: RoleInfo[]; value: string[]; onChange: (ids: string[]) => void }) {
  return (
    <div className="flex flex-col gap-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((id) => {
            const role = roles.find((r) => r.id === id);
            return (
              <Chip key={id} color={role?.color} onRemove={() => onChange(value.filter((v) => v !== id))}>
                @{role?.name ?? 'rol borrado'}
              </Chip>
            );
          })}
        </div>
      )}
      <select className={inputClass} value="" onChange={(e) => e.target.value && onChange([...value, e.target.value])}>
        <option value="">+ Agregar rol</option>
        {roles
          .filter((r) => !r.managed && !value.includes(r.id))
          .map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
      </select>
    </div>
  );
}

export function TagEditor({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const [text, setText] = useState('');
  const add = () => {
    const v = text.trim().toLowerCase();
    if (v.length >= 2 && !value.includes(v)) onChange([...value, v]);
    setText('');
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {value.map((v) => (
          <Chip key={v} onRemove={() => onChange(value.filter((x) => x !== v))}>
            {v}
          </Chip>
        ))}
      </div>
      <div className="flex gap-2">
        <TextInput
          value={text}
          onChange={setText}
          placeholder={placeholder}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button variant="secondary" icon={Plus} onClick={add}>
          Agregar
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- people

export function Avatar({ src, size = 28 }: { src?: string | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  return src && !failed ? (
    <img src={cdn(src)} width={size} height={size} alt="" onError={() => setFailed(true)} className="shrink-0 rounded-full bg-surface-3 object-cover" style={{ width: size, height: size }} />
  ) : (
    <span className="shrink-0 rounded-full bg-surface-3" style={{ width: size, height: size }} />
  );
}

export function UserRow({ user, children, badge }: { user: Partial<UserInfo> & { id: string }; children?: ReactNode; badge?: ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg bg-surface-2 px-2.5 py-2">
      <Avatar src={user.avatar} />
      <div className="min-w-0 flex-1 truncate">
        {user.name ?? user.id}
        {user.username && <span className="text-xs text-muted"> @{user.username}</span>}
        {badge}
      </div>
      {children && <div className="flex shrink-0 items-center gap-1">{children}</div>}
    </div>
  );
}

/** Search server members; `actions` renders the buttons for each result. */
export function MemberSearch({
  exclude = [],
  actions,
  placeholder = 'Buscar miembro por nombre…',
}: {
  exclude?: string[];
  actions: (user: UserInfo, clear: () => void) => ReactNode;
  placeholder?: string;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserInfo[] | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const toast = useToast();

  useEffect(() => {
    clearTimeout(timer.current);
    const q = query.trim();
    if (q.length < 2) return setResults(null);
    timer.current = setTimeout(() => {
      api<UserInfo[]>(`/members/search?q=${encodeURIComponent(q)}`)
        .then(setResults)
        .catch((e) => toast(errorMessage(e), 'error'));
    }, 300);
  }, [query, toast]);

  const clear = () => {
    setQuery('');
    setResults(null);
  };
  const visible = results?.filter((u) => !exclude.includes(u.id));

  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <TextInput value={query} onChange={setQuery} placeholder={placeholder} className="pl-9" type="search" />
      </div>
      {visible && (visible.length ? visible.map((u) => <UserRow key={u.id} user={u}>{actions(u, clear)}</UserRow>) : <Empty>Sin resultados.</Empty>)}
    </div>
  );
}

// -------------------------------------------------------------- save bar

export function SaveBar({ dirty, saving, onSave, onReset }: { dirty: boolean; saving: boolean; onSave: () => void; onReset: () => void }) {
  return (
    <div
      className={cx(
        'fixed bottom-4 left-1/2 z-40 flex w-[min(720px,calc(100%-32px))] -translate-x-1/2 flex-wrap items-center justify-between gap-3 rounded-xl bg-[#111214] py-2.5 pl-4 pr-3 shadow-2xl transition-transform duration-200',
        dirty ? 'translate-y-0' : 'translate-y-[160%]',
      )}
    >
      <span>Tienes cambios sin guardar</span>
      <div className="flex gap-2">
        <Button variant="ghost" onClick={onReset}>
          Descartar
        </Button>
        <Button variant="primary" loading={saving} onClick={onSave}>
          Guardar cambios
        </Button>
      </div>
    </div>
  );
}
