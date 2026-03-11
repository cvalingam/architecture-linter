import { OrderRepository } from '../repositories/orderRepository';

export class OrderController {
  constructor(private repo: OrderRepository) {}
  getOrder(id: string) { return this.repo.findById(id); }
}
