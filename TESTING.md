# Testing Standards - MANDATORY READING

## ❌ BAD: Tests That Always Pass (FORBIDDEN)

### Example 1: Tautological Test
```typescript
// ❌ NEVER DO THIS
it('should return true', () => {
  expect(true).toBe(true);
});

// ❌ NEVER DO THIS
it('should create user', async () => {
  const mockUser = { id: '1', name: 'Test' };
  jest.spyOn(db, 'insert').mockResolvedValue(mockUser);
  
  const result = await createUser({ name: 'Test' });
  expect(result).toEqual(mockUser); // Testing the mock, not the function!
});
```

### Example 2: Empty Try-Catch
```typescript
// ❌ NEVER DO THIS
it('should handle errors', async () => {
  try {
    await someFunction();
  } catch (e) {
    // Silently passes even if it should fail
  }
});
```

### Example 3: No Assertions
```typescript
// ❌ NEVER DO THIS
it('should process payment', async () => {
  const payment = { amount: 100 };
  await processPayment(payment);
  // No assertions - what are we testing?
});
```

## ✅ GOOD: Tests That Actually Test

### Example 1: Testing Real Behavior
```typescript
// ✅ CORRECT WAY
it('should calculate order total with tax', () => {
  const items = [
    { price: 100, quantity: 2 },
    { price: 50, quantity: 1 }
  ];
  const taxRate = 0.08;
  
  const result = calculateOrderTotal(items, taxRate);
  
  expect(result.subtotal).toBe(250);
  expect(result.tax).toBe(20);
  expect(result.total).toBe(270);
});

// ✅ CORRECT WAY - Testing error conditions
it('should throw error for invalid rating', async () => {
  const invalidReview = {
    rating: 6, // Invalid: should be 1-5
    title: 'Test',
    comment: 'Test review'
  };
  
  await expect(createReview(invalidReview))
    .rejects.toThrow('Rating must be between 1 and 5');
});
```

### Example 2: Integration Test
```typescript
// ✅ CORRECT WAY - Test the full flow
it('should create order and update inventory', async () => {
  // Setup
  const product = await createTestProduct({ inventory: 10 });
  const user = await createTestUser();
  
  // Action
  const order = await createOrder({
    userId: user.id,
    items: [{ productId: product.id, quantity: 3 }]
  });
  
  // Assertions - verify all side effects
  expect(order.status).toBe('pending');
  expect(order.total).toBeGreaterThan(0);
  
  // Verify inventory was updated
  const updatedProduct = await getProduct(product.id);
  expect(updatedProduct.inventory).toBe(7);
  
  // Verify order items were created
  const orderItems = await getOrderItems(order.id);
  expect(orderItems).toHaveLength(1);
  expect(orderItems[0].quantity).toBe(3);
});
```

### Example 3: Testing Edge Cases
```typescript
// ✅ CORRECT WAY - Test boundaries and edge cases
describe('Cart quantity limits', () => {
  it('should prevent adding more items than available inventory', async () => {
    const product = await createTestProduct({ inventory: 5 });
    const cart = await createTestCart();
    
    // Try to add more than available
    await expect(
      addToCart({
        cartId: cart.id,
        productId: product.id,
        quantity: 10
      })
    ).rejects.toThrow('Insufficient inventory');
  });
  
  it('should handle concurrent cart updates', async () => {
    const product = await createTestProduct({ inventory: 3 });
    const cart = await createTestCart();
    
    // Simulate concurrent requests
    const promises = [
      addToCart({ cartId: cart.id, productId: product.id, quantity: 2 }),
      addToCart({ cartId: cart.id, productId: product.id, quantity: 2 })
    ];
    
    // One should succeed, one should fail
    const results = await Promise.allSettled(promises);
    const succeeded = results.filter(r => r.status === 'fulfilled');
    const failed = results.filter(r => r.status === 'rejected');
    
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
  });
});
```

## Test Quality Metrics

### Minimum Requirements
- **Assertion Density**: At least 2 assertions per test
- **Mock Limit**: Maximum 3 mocks per test file
- **No Skipped Tests**: All tests must run (no .skip or .todo)
- **Error Handling**: Use expect().rejects instead of try/catch
- **Integration Focus**: Prefer testing real behavior over mocking

### Anti-Patterns to Avoid
1. **Testing Implementation Details**: Test behavior, not how it's implemented
2. **Over-Mocking**: If you're mocking everything, you're not testing anything
3. **Snapshot Overuse**: Snapshots should complement assertions, not replace them
4. **Magic Numbers**: Use named constants to explain test values
5. **Test Interdependence**: Each test should be independent

## Running Test Quality Checks

```bash
# Run test quality audit
bun run scripts/test-audit/test-quality-guard.ts

# Run on specific files
bun run scripts/test-audit/test-quality-guard.ts "apps/web/src/**/*.test.ts"
```

## Enforcement

The test quality guard is run automatically in CI and will:
- **Block PRs** with test quality errors
- **Warn** about quality issues that should be improved
- **Report** assertion density and mock usage statistics

Remember: The goal is to have tests that actually catch bugs, not just increase coverage numbers.