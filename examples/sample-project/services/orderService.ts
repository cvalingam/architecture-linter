import { Order, OrderRepository } from '../repositories/orderRepository';

/**
 * Contains business logic for the Order domain.
 * The service layer is the only one allowed to interact with repositories.
 */
export class OrderService {
  private readonly repository: OrderRepository;

  constructor() {
    this.repository = new OrderRepository();
  }

  async getOrder(id: string): Promise<Order> {
    const order = await this.repository.findById(id);
    if (!order) {
      throw new Error(`Order not found: ${id}`);
    }
    return order;
  }

  async listOrders(): Promise<Order[]> {
    return this.repository.findAll();
  }

  async createOrder(order: Order): Promise<void> {
    await this.repository.save(order);
  }

  async cancelOrder(id: string): Promise<Order> {
    const order = await this.getOrder(id);
    const updated: Order = { ...order, status: 'cancelled' };
    await this.repository.save(updated);
    return updated;
  }
}
