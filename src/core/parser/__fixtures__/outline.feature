Feature: Discount calculation

  Scenario Outline: Apply a coupon to the cart total
    Given a cart total of <total>
    When a "<coupon>" coupon is applied
    Then the final total is <final>

    Examples:
      | total | coupon | final |
      | 100   | SAVE10 | 90    |
      | 200   | SAVE20 | 160   |
