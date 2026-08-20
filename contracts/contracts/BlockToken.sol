// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title BlockToken ($BLOCK)
 * @notice The game's currency.
 *
 * @dev Emission is capped *per day*, not just in total. That single constraint
 *      is the main defence against a runaway economy: even if game logic has a
 *      bug that mints far too much, the damage is bounded by one day's cap and
 *      is visible on-chain immediately.
 *
 *      Minting is restricted to authorised game controllers so the server can
 *      settle batches without holding an unbounded mint key.
 */
contract BlockToken is ERC20, Ownable {
    /// @notice Maximum newly-minted supply per UTC day.
    uint256 public dailyCap;

    /// @notice day index => amount already minted that day.
    mapping(uint256 => uint256) public mintedOn;

    mapping(address => bool) public isMinter;

    event MinterSet(address indexed minter, bool allowed);
    event DailyCapSet(uint256 cap);

    error NotMinter();
    error DailyCapExceeded(uint256 requested, uint256 remaining);
    error ZeroAddress();

    modifier onlyMinter() {
        if (!isMinter[msg.sender]) revert NotMinter();
        _;
    }

    constructor(uint256 dailyCap_) ERC20("Quanto Block", "BLOCK") Ownable(msg.sender) {
        dailyCap = dailyCap_;
        emit DailyCapSet(dailyCap_);
    }

    function setMinter(address minter, bool allowed) external onlyOwner {
        if (minter == address(0)) revert ZeroAddress();
        isMinter[minter] = allowed;
        emit MinterSet(minter, allowed);
    }

    function setDailyCap(uint256 cap) external onlyOwner {
        dailyCap = cap;
        emit DailyCapSet(cap);
    }

    /// @notice Current UTC day index.
    function today() public view returns (uint256) {
        return block.timestamp / 1 days;
    }

    /// @notice How much may still be minted today.
    function remainingToday() public view returns (uint256) {
        uint256 used = mintedOn[today()];
        return used >= dailyCap ? 0 : dailyCap - used;
    }

    function mint(address to, uint256 amount) external onlyMinter {
        uint256 remaining = remainingToday();
        if (amount > remaining) revert DailyCapExceeded(amount, remaining);
        mintedOn[today()] += amount;
        _mint(to, amount);
    }

    /// @notice Burned by sinks — floor upgrades, signs, re-rolls.
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }
}
