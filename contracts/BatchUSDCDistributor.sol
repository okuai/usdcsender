// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract BatchUSDCDistributor {
  using SafeERC20 for IERC20;

  error EmptyBatch();
  error InvalidToken();
  error LengthMismatch();
  error InvalidRecipient(uint256 index);
  error InvalidAmount(uint256 index);

  event BatchTransfer(
    address indexed sender,
    address indexed token,
    uint256 recipientCount,
    uint256 totalAmount
  );

  function batchTransferFrom(
    address token,
    address[] calldata recipients,
    uint256[] calldata amounts
  ) external {
    uint256 recipientCount = recipients.length;
    if (token == address(0)) revert InvalidToken();
    if (recipientCount == 0) revert EmptyBatch();
    if (recipientCount != amounts.length) revert LengthMismatch();

    IERC20 erc20 = IERC20(token);
    uint256 totalAmount;

    for (uint256 i = 0; i < recipientCount; i++) {
      address recipient = recipients[i];
      uint256 amount = amounts[i];

      if (recipient == address(0)) revert InvalidRecipient(i);
      if (amount == 0) revert InvalidAmount(i);

      totalAmount += amount;
    }

    erc20.safeTransferFrom(msg.sender, address(this), totalAmount);

    for (uint256 i = 0; i < recipientCount; i++) {
      erc20.safeTransfer(recipients[i], amounts[i]);
    }

    emit BatchTransfer(
      msg.sender,
      token,
      recipientCount,
      totalAmount
    );
  }
}
