import { api } from "./client";
import type { User } from "./types";

export const listUsers = () => api<User[]>("/users");

export const updateUser = (id: string, body: Partial<User>) =>
  api<User>(`/users/${id}`, { method: "PATCH", body });

export const deactivateUser = (id: string) =>
  api<User>(`/users/${id}/deactivate`, { method: "POST" });
