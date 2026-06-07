import { api } from "./client";
import type { Client } from "./types";

export const listClients = () => api<Client[]>("/clients");

export const getClient = (id: string) => api<Client>(`/clients/${id}`);

export const createClient = (body: Partial<Client>) =>
  api<Client>("/clients", { method: "POST", body });

export const updateClient = (id: string, body: Partial<Client>) =>
  api<Client>(`/clients/${id}`, { method: "PATCH", body });

export const deleteClient = (id: string) =>
  api<void>(`/clients/${id}`, { method: "DELETE" });
