"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard, Radar, PackageSearch, Store, ShoppingCart, Boxes, Receipt, Megaphone, Wallet, Settings, Menu, X,
} from "lucide-react";

export const NAV = [
  { href: "/", label: "نظرة عامة", icon: LayoutDashboard },
  { href: "/trends", label: "رادار الترند", icon: Radar },
  { href: "/products", label: "أبحاث المنتجات", icon: PackageSearch },
  { href: "/suppliers", label: "الموردون", icon: Store },
  { href: "/purchases", label: "قرارات الشراء", icon: ShoppingCart },
  { href: "/inventory", label: "المخزون", icon: Boxes },
  { href: "/orders", label: "الطلبات", icon: Receipt },
  { href: "/marketing", label: "التسويق والمحتوى", icon: Megaphone },
  { href: "/finance", label: "المالية", icon: Wallet },
  { href: "/settings", label: "الإعدادات والتكاملات", icon: Settings },
];

export function Nav({ badges }: { badges: Record<string, number> }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const items = (
    <nav className="flex flex-col gap-0.5 p-3">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? path === "/" : path.startsWith(href);
        return (
          <Link key={href} href={href} onClick={() => setOpen(false)}
            className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm ${active ? "bg-accent-soft font-semibold text-accent" : "text-text-2 hover:bg-surface-2"}`}>
            <Icon size={17} strokeWidth={1.8} aria-hidden />
            <span className="flex-1">{label}</span>
            {badges[href] ? <span className="num rounded-full bg-accent px-1.5 text-[11px] font-semibold text-accent-ink">{badges[href]}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
  return (
    <>
      <button className="fixed top-2 right-2 z-40 rounded-lg border border-border bg-surface p-2 lg:hidden" onClick={() => setOpen(true)} aria-label="القائمة">
        <Menu size={18} />
      </button>
      {open && (
        <div className="fixed inset-0 z-50 bg-black/40 lg:hidden" onClick={() => setOpen(false)}>
          <div className="h-full w-72 bg-surface" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-end p-3"><button onClick={() => setOpen(false)} aria-label="إغلاق"><X size={18} /></button></div>
            {items}
          </div>
        </div>
      )}
      <div className="hidden lg:block">{items}</div>
    </>
  );
}
