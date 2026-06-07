import { api } from "./client";

export interface Contact {
  id: string;
  full_name: string;
  role_title: string | null;
  email: string | null;
  phone: string | null;
  manager_name: string | null;
}

export const listContacts = (clientId: string) =>
  api<Contact[]>(`/clients/${clientId}/contacts`);

export const createContact = (clientId: string, body: Partial<Contact>) =>
  api<Contact>(`/clients/${clientId}/contacts`, { method: "POST", body });

export const deleteContact = (clientId: string, contactId: string) =>
  api<void>(`/clients/${clientId}/contacts/${contactId}`, { method: "DELETE" });
