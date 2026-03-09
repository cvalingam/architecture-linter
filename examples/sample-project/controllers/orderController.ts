import { OrderService } from '../services/orderService';
import { OrderRepository } from '../repositories/orderRepository'; // ❌ violation: controller importing repository directly

/**
 * HTTP handler for Order endpoints.
 *
 * This file deliberately contains two patterns for demo purposes:
 *
 *  1. A plain violation — the import of OrderRepository above is detected and reported.
 *  2. A suppressed violation — the second repository import below is preceded by an
 *     // arch-ignore comment, so the linter skips it.
 *
 * In real usage, prefer fixing violations rather than ignoring them.
 * Use arch-ignore only for intentional, documented exceptions.
 */
export class OrderController {
  private readonly orderService: OrderService;
  // ❌ This bypasses the service layer and breaks the architecture contract.
  private readonly orderRepository: OrderRepository;

  constructor() {
    this.orderService = new OrderService();
    this.orderRepository = new OrderRepository(); // should not be here
  }

  async handleGetOrder(id: string): Promise<void> {
    const order = await this.orderService.getOrder(id);
    console.log('Order:', JSON.stringify(order, null, 2));
  }

  async handleListOrders(): Promise<void> {
    // ❌ Calling the repository directly instead of going through the service.
    const orders = await this.orderRepository.findAll();
    console.log('Orders:', JSON.stringify(orders, null, 2));
  }
}
