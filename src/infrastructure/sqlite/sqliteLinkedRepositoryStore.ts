import type { DatabaseSync } from "node:sqlite";
import type { LinkedRepository } from "../../domain/repository.js";
import type { ILinkedRepositoryStore } from "../../ports/stores.js";

type Row = { name: string; path: string; linked_at: string };

/** Linked folders by name. Names are matched without case, like folder names on Windows. */
export class SqliteLinkedRepositoryStore implements ILinkedRepositoryStore {
  constructor(private readonly db: DatabaseSync) {}

  save(repository: LinkedRepository): void {
    this.db.prepare("INSERT INTO linked_repositories (name, path, linked_at) VALUES (?, ?, ?)")
      .run(repository.name, repository.path, repository.linkedAt);
  }

  get(name: string): LinkedRepository | undefined {
    const row = this.db.prepare("SELECT * FROM linked_repositories WHERE name = ?").get(name) as Row | undefined;
    return row ? toLinked(row) : undefined;
  }

  all(): LinkedRepository[] {
    return (this.db.prepare("SELECT * FROM linked_repositories ORDER BY name").all() as Row[]).map(toLinked);
  }

  remove(name: string): boolean {
    return this.db.prepare("DELETE FROM linked_repositories WHERE name = ?").run(name).changes > 0;
  }
}

function toLinked(row: Row): LinkedRepository {
  return { name: row.name, path: row.path, linkedAt: row.linked_at };
}
