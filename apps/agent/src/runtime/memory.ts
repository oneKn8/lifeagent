import {
  type AddMemoryFactInput,
  type Db,
  type MemoryFact,
  addMemoryFact,
  searchMemoryFacts,
  topMemoryFacts,
} from "@lifeagent/db";

export class MemoryStore {
  constructor(private readonly db: Db) {}

  addFact(input: AddMemoryFactInput): Promise<MemoryFact> {
    return addMemoryFact(this.db, input);
  }

  topRecent(userId: string, n: number): Promise<MemoryFact[]> {
    return topMemoryFacts(this.db, userId, n);
  }

  recall(userId: string, query: string): Promise<MemoryFact[]> {
    return searchMemoryFacts(this.db, userId, query);
  }
}
