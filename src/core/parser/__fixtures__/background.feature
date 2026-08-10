Feature: Shopping cart

  Background:
    Given the store is open
    And the catalog has items

  Scenario: Add item to cart
    When the user adds an item to the cart
    Then the cart shows one item

  Scenario: Remove item from cart
    Given the cart already has one item
    When the user removes the item
    Then the cart is empty
