import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowRight, ClipboardList, FlaskConical, LogOut, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import logoAsset from "@/assets/euss-logo.png.asset.json";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Панель смены — EuSS" },
      { name: "description", content: "Рабочая панель смены EuSS: стиральные машины, показатели и записи." },
      { property: "og:title", content: "Панель смены — EuSS" },
      { property: "og:description", content: "Состояние стиральных машин и показатели текущей смены EuSS." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

type MachineStatus = "working" | "ready" | "service" | "rinse";

type Machine = {
  id: number;
  status: MachineStatus;
  detail: string;
  time?: string;
};

const machines: Machine[] = [
  { id: 1, status: "working", detail: "Хлопок 60°", time: "14 мин" },
  { id: 2, status: "ready", detail: "Готова к загрузке" },
  { id: 3, status: "service", detail: "Требуется проверка" },
  { id: 4, status: "working", detail: "Белое бельё", time: "42 мин" },
  { id: 5, status: "rinse", detail: "Полоскание", time: "9 мин" },
  { id: 6, status: "ready", detail: "Готова к загрузке" },
  { id: 7, status: "working", detail: "Деликатная", time: "26 мин" },
  { id: 8, status: "ready", detail: "Готова к загрузке" },
  { id: 9, status: "working", detail: "Хлопок 40°", time: "18 мин" },
  { id: 10, status: "ready", detail: "Готова к загрузке" },
  { id: 11, status: "working", detail: "Спецодежда", time: "33 мин" },
  { id: 12, status: "ready", detail: "Готова к загрузке" },
];

const statusText: Record<MachineStatus, string> = {
  working: "Стирка",
  ready: "Свободна",
  service: "Сервис",
  rinse: "Полоскание",
};

const tabs = [
  { id: "all", label: "Все машины" },
  { id: "main", label: "Дозатор 1 · 1–10" },
  { id: "extra", label: "Дозатор 2 · 11–12" },
] as const;

function Dashboard() {
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]["id"]>("all");
  const [selected, setSelected] = useState<Machine | null>(null);

  const visibleMachines = useMemo(() => {
    if (activeTab === "main") return machines.filter((machine) => machine.id <= 10);
    if (activeTab === "extra") return machines.filter((machine) => machine.id >= 11);
    return machines;
  }, [activeTab]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <img src={logoAsset.url} alt="EuSS" className="h-9 w-auto max-w-28 object-contain" />
            <span className="hidden h-6 w-px bg-border sm:block" />
            <span className="truncate text-sm font-semibold text-muted-foreground">Панель смены</span>
          </div>
          <div className="flex items-center gap-3 sm:gap-5">
            <div className="hidden text-right sm:block">
              <p className="text-[11px] font-extrabold uppercase text-primary">Смена активна</p>
              <p className="text-xs font-semibold">08:00–20:00 · Алексей Иванов</p>
            </div>
            <div className="grid size-9 place-items-center rounded-full bg-foreground text-xs font-bold text-primary-foreground">АИ</div>
            <Button variant="ghost" size="icon" aria-label="Выйти" title="Выйти">
              <LogOut />
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] px-4 py-5 sm:px-6 sm:py-7">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-1 text-xs font-bold uppercase text-primary">Сегодня, 5 октября</p>
            <h1 className="font-display text-2xl font-bold sm:text-3xl">Обзор текущей смены</h1>
          </div>
          <Button
            className="h-10 px-4"
            onClick={() => {
              const availableMachine = machines.find((machine) => machine.status === "ready");
              if (availableMachine) setSelected(availableMachine);
            }}
          >
            <Plus /> Новая запись
          </Button>
        </div>

        <section className="metric-grid" aria-label="Статистика смены">
          <Metric label="Стирок" value="42" note="за смену" tone="primary" />
          <Metric label="Общий вес" value="482" unit="кг" note="+8% к прошлой" tone="ink" />
          <Metric label="Химия" value="12,4" unit="л" note="по норме" tone="soft" />
          <Metric label="В работе" value="6 / 12" note="1 требует внимания" tone="warning" />
        </section>

        <section className="mt-6" aria-labelledby="machines-title">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 id="machines-title" className="font-display text-lg font-bold">Стиральные машины</h2>
              <p className="text-sm text-muted-foreground">Выберите машину, чтобы открыть запись</p>
            </div>
            <div className="flex max-w-full gap-1 overflow-x-auto rounded-lg bg-secondary p-1" role="tablist" aria-label="Группы машин">
              {tabs.map((tab) => (
                <Button
                  key={tab.id}
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  variant={activeTab === tab.id ? "secondary" : "ghost"}
                  size="sm"
                  className={cn("shrink-0 shadow-none", activeTab === tab.id && "bg-card text-primary")}
                  onClick={() => setActiveTab(tab.id)}
                >
                  {tab.label}
                </Button>
              ))}
            </div>
          </div>

          <div className="machine-grid">
            {visibleMachines.map((machine) => (
              <MachineTile key={machine.id} machine={machine} onOpen={() => setSelected(machine)} />
            ))}
          </div>
        </section>

        <section className="mt-7 grid gap-3 pb-10 md:grid-cols-2" aria-label="Быстрые действия">
          <QuickAction icon={<ClipboardList />} title="Бланк за смену" text="Проверить и подготовить отчёт" />
          <QuickAction icon={<FlaskConical />} title="Замена химии" text="Зафиксировать остаток и новый баллон" />
        </section>
      </main>

      {selected && <MachinePanel machine={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function Metric({ label, value, unit, note, tone }: { label: string; value: string; unit?: string; note: string; tone: string }) {
  return (
    <article className={cn("metric", `metric-${tone}`)}>
      <p className="text-[11px] font-extrabold uppercase text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-2xl font-bold sm:text-[28px]">
        {value} {unit && <span className="text-sm font-semibold text-muted-foreground">{unit}</span>}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{note}</p>
    </article>
  );
}

function MachineTile({ machine, onOpen }: { machine: Machine; onOpen: () => void }) {
  const active = machine.status === "working" || machine.status === "rinse";
  return (
    <article className={cn("machine-card", `machine-${machine.status}`)}>
      <button type="button" className="machine-visual" onClick={onOpen} aria-label={`Машина ${machine.id}: ${statusText[machine.status]}`}>
        <span className="machine-controls"><i /><i /><i /></span>
        <span className={cn("machine-door", active && "machine-door-active")}>
          <strong>{String(machine.id).padStart(2, "0")}</strong>
        </span>
        <span className="machine-status">{statusText[machine.status]}{machine.time ? ` · ${machine.time}` : ""}</span>
      </button>
      <Button variant={machine.status === "service" ? "destructive" : active ? "default" : "outline"} size="sm" className="w-full" onClick={onOpen}>
        {machine.status === "ready" ? "Добавить загрузку" : "Открыть"} <ArrowRight />
      </Button>
    </article>
  );
}

function QuickAction({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <button type="button" className="quick-action">
      <span className="quick-icon">{icon}</span>
      <span className="min-w-0 flex-1 text-left">
        <strong className="block text-sm">{title}</strong>
        <span className="block truncate text-xs text-muted-foreground">{text}</span>
      </span>
      <ArrowRight className="size-4 text-muted-foreground" />
    </button>
  );
}

function MachinePanel({ machine, onClose }: { machine: Machine; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-end bg-foreground/25 p-0 sm:p-4" role="presentation" onMouseDown={onClose}>
      <section className="w-full max-w-md bg-card p-5 shadow-2xl sm:rounded-lg" role="dialog" aria-modal="true" aria-labelledby="machine-dialog" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase text-primary">{statusText[machine.status]}</p>
            <h2 id="machine-dialog" className="mt-1 font-display text-2xl font-bold">Машина {String(machine.id).padStart(2, "0")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{machine.detail}{machine.time ? ` · осталось ${machine.time}` : ""}</p>
          </div>
          <Button variant="ghost" size="icon" aria-label="Закрыть" onClick={onClose}><X /></Button>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3 border-y border-border py-4 text-sm">
          <div><span className="block text-xs text-muted-foreground">Дозатор</span><strong>{machine.id <= 10 ? "Основной" : "Отдельный"}</strong></div>
          <div><span className="block text-xs text-muted-foreground">Группа</span><strong>{machine.id <= 10 ? "1–10" : "11–12"}</strong></div>
        </div>
        <Button className="mt-5 w-full">{machine.status === "ready" ? "Добавить загрузку" : "Перейти к записи"}</Button>
      </section>
    </div>
  );
}
