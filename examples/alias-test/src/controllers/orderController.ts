import { OrderRepository } from '@repositories/orderRepository';

export class OrderController {
  constructor(private repo: OrderRepository) {}
}
