import type { Metadata } from "next";
import { Suspense } from "react";
import Header from "@/components/layout/Header";
import "./globals.css";

export const metadata: Metadata = {
  title: "PujaFácil — Casa de subastas",
  description: "Plataforma de subastas en línea para PYMES",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className="h-full">
      <body className="flex min-h-screen flex-col">
        <Suspense fallback={null}>
          <Header />
        </Suspense>
        {/* Las páginas ya declaran su propio main; evitamos landmarks anidados. */}
        <div className="flex-1">{children}</div>
      </body>
    </html>
  );
}
