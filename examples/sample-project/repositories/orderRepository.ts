export interface Order {
  id: string;
  customerId: string;
  total: number;
  status: 'pending' | 'completed' | 'cancelled';
}

/**
 * Provides raw data access for the Order domain.
 * This is the only layer that is allowed to talk to the data store.
 */
export class OrderRepository {
  // In a real app this would wrap a database client.
  private readonly store: Map<string, Order> = new Map();

  async findById(id: string): Promise<Order | undefined> {
    return this.store.get(id);
  }

  async findAll(): Promise<Order[]> {
    return Array.from(this.store.values());
  }

  async save(order: Order): Promise<void> {
    this.store.set(order.id, order);
  }

  async delete(id: string): Promise<boolean> {
    return this.store.delete(id);
  }
}
