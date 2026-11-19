import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Prueba aislada del efecto de carga del cliente; la autorización se prueba con PostgreSQL en C1.
const hooks = vi.hoisted(() => ({ effects: [] as Array<() => (() => void) | void>, setters: [] as ReturnType<typeof vi.fn>[] }));
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useState: (initial: unknown) => { const setter = vi.fn(); hooks.setters.push(setter); return [initial, setter]; },
  useEffect: (effect: () => (() => void) | void) => { hooks.effects.push(effect); },
}));
import AccountReview from "../app/admin/usuarios/AccountReview";

const fetchMock = vi.fn<typeof fetch>();
afterEach(() => vi.unstubAllGlobals());
beforeEach(() => {
  hooks.effects.length = 0; hooks.setters.length = 0;
  fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:imagen-ficticia");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});

function renderLoad(mimeType: string) {
  fetchMock.mockResolvedValueOnce(Response.json({ ok: true, data: {
    reviewId: "revision", user: { nombreCompleto: "Persona ficticia", cedula: "1234567890" }, identity: { id: "identidad", mimeType },
  } }));
  AccountReview({ userId: "pendiente", onClose: vi.fn(), onActivated: vi.fn() });
  return hooks.effects[0]();
}
async function loaded() { await vi.waitFor(() => expect(hooks.setters[1]).toHaveBeenCalledWith(false)); }

describe("Christian C1 — carga de documentos en el cliente", () => {
  it.each(["application/pdf", "image/png", "image/jpeg", "image/webp"])("%s consulta una sola vez el archivo protegido para la vista previa y libera su URL", async (mimeType) => {
    const cleanup = renderLoad(mimeType);
    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": mimeType } }));
    await loaded();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith("/api/files/identidad", expect.objectContaining({ credentials: "same-origin", cache: "no-store" }));
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    expect(hooks.setters[0]).toHaveBeenCalledWith(expect.objectContaining({ objectUrl: "blob:imagen-ficticia" }));
    cleanup?.(); expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:imagen-ficticia");
  });
  it("un error de lectura de imagen muestra el error sin habilitar una revisión ni crear URLs", async () => {
    renderLoad("image/png");
    fetchMock.mockResolvedValueOnce(Response.json({ ok: false, error: { message: "No se pudo registrar la consulta." } }, { status: 500 }));
    await loaded();
    expect(hooks.setters[0]).not.toHaveBeenCalled();
    expect(hooks.setters[2]).toHaveBeenCalledWith("No se pudo registrar la consulta.");
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});
