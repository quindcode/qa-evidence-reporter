Feature: Product search
  As a shopper
  I want to search for products by keyword and filter results
  so that I can find what I need quickly.

  @smoke
  Scenario: Search returns matching products
    Given the shopper is on the store home page
    When they search for "wireless headphones"
    Then a list of matching products is displayed
    And each result shows a product image, name and price

  @regression
  Scenario: Search with no results shows an empty state
    Given the shopper is on the store home page
    When they search for "asdkjqwoe123nonexistent"
    Then an empty state message is displayed
    And a suggestion to browse categories is shown

  @regression
  Scenario Outline: Filtering search results by category
    Given the shopper searched for "shoes"
    When they filter the results by category "<category>"
    Then only products from the "<category>" category are shown

    Examples:
      | category |
      | Running  |
      | Casual   |
      | Formal   |
