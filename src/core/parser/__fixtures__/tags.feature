@regression
Feature: Payments

  @smoke @critical
  Scenario: Successful payment with a valid card
    Given a valid card
    When the payment is submitted
    Then the payment is approved

  Scenario: Declined payment with an expired card
    Given an expired card
    When the payment is submitted
    Then the payment is declined
