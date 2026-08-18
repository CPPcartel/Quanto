// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {BlockToken} from "./BlockToken.sol";
import {FloorDeed} from "./FloorDeed.sol";
import {OracleRouter} from "./OracleRouter.sol";

/**
 * @title CityController
 * @notice The only contract that changes game state. Buys floors, settles the
 *         wages the game server has computed, and prices everything off live
 *         Chainlink data through OracleRouter.
 *
 * @dev Two design rules carried down from the game design, both deliberate:
 *
 *      1. **Payouts are tier-bucketed, never continuous.** Yield is a function
 *         of a four-step volatility bucket, not of price change. A linear
 *         payoff referencing real security prices reads as a derivative; a
 *         coarse game stat does not. Do not "improve" this into a smooth curve.
 *
 *      2. **Nothing pays more for up than for down.** Direction is never an
 *         input to any payout in this contract.
 */
contract CityController is Ownable, ReentrancyGuard {
    BlockToken public immutable blockToken;
    FloorDeed public immutable floorDeed;
    OracleRouter public immutable oracle;

    /// @notice Base floor price in $BLOCK (18 decimals), before tier scaling.
    uint256 public baseFloorPrice = 100 ether;

    /// @notice Tier multipliers in basis points: calm, normal, hot, extreme.
    uint16[4] public tierBps = [10000, 16000, 24000, 35000];

    /// @notice Backend signer permitted to settle wage batches.
    mapping(address => bool) public isSettler;

    /// @notice Guards against replaying a settlement batch.
    mapping(bytes32 => bool) public settledBatches;

    event FloorPurchased(
        address indexed buyer,
        bytes32 indexed symbol,
        uint256 indexed floor,
        uint256 price
    );
    event WagesSettled(bytes32 indexed batchId, uint256 recipients, uint256 total);
    event SettlerSet(address indexed settler, bool allowed);
    event BaseFloorPriceSet(uint256 price);

    error NotSettler();
    error BatchAlreadySettled(bytes32 batchId);
    error LengthMismatch();
    error BadTier(uint8 tier);
    error PriceUnavailable(bytes32 symbol);
    error ZeroAddress();

    modifier onlySettler() {
        if (!isSettler[msg.sender]) revert NotSettler();
        _;
    }

    constructor(BlockToken token_, FloorDeed deed_, OracleRouter oracle_) Ownable(msg.sender) {
        blockToken = token_;
        floorDeed = deed_;
        oracle = oracle_;
    }

    function setSettler(address settler, bool allowed) external onlyOwner {
        if (settler == address(0)) revert ZeroAddress();
        isSettler[settler] = allowed;
        emit SettlerSet(settler, allowed);
    }

    function setBaseFloorPrice(uint256 price) external onlyOwner {
        baseFloorPrice = price;
        emit BaseFloorPriceSet(price);
    }

    function setTierBps(uint16[4] calldata bps) external onlyOwner {
        tierBps = bps;
    }

    /**
     * @notice Price of a floor in a given tower at a given volatility tier.
     * @dev Reverts if the feed is unusable, so nobody can buy into a tower
     *      whose price we cannot currently establish.
     */
    function floorPrice(bytes32 symbol, uint8 tier) public view returns (uint256) {
        if (tier > 3) revert BadTier(tier);

        (bool ok, int256 price, , ) = oracle.tryReadPrice(symbol);
        if (!ok || price <= 0) revert PriceUnavailable(symbol);

        // Scale gently with the share price so a $600 tower costs more than a
        // $20 one, without letting a $60k tower cost 3000x as much.
        uint256 priceUnits = uint256(price) / 1e8; // feeds are 8 decimals
        uint256 scale = 1 ether + (priceUnits * 1 ether) / 400;

        return (baseFloorPrice * scale * tierBps[tier]) / (1 ether * 10000);
    }

    /**
     * @notice Buy the next floor in a tower. Payment is burned, not pooled —
     *         floors are a sink, which is what keeps emission from compounding.
     */
    function buyFloor(bytes32 symbol, uint8 tier) external nonReentrant returns (uint256 tokenId) {
        uint256 price = floorPrice(symbol, tier);
        uint256 nextFloor = floorDeed.mintedFloors(symbol);

        // Burn from the buyer directly; requires no allowance dance.
        blockToken.transferFrom(msg.sender, address(this), price);
        blockToken.burn(price);

        tokenId = floorDeed.mintFloor(msg.sender, symbol, nextFloor);
        emit FloorPurchased(msg.sender, symbol, nextFloor, price);
    }

    /**
     * @notice Settle a batch of off-chain-earned wages.
     *
     * @dev The game server computes wages continuously off-chain and settles
     *      them periodically; doing it per-action would be pointless gas. The
     *      batch id makes replay impossible, and BlockToken's own daily cap
     *      bounds the blast radius if the server is ever compromised.
     */
    function settleWages(
        bytes32 batchId,
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external onlySettler nonReentrant {
        if (settledBatches[batchId]) revert BatchAlreadySettled(batchId);
        if (recipients.length != amounts.length) revert LengthMismatch();

        settledBatches[batchId] = true;

        uint256 total;
        for (uint256 i = 0; i < recipients.length; i++) {
            if (recipients[i] == address(0)) revert ZeroAddress();
            blockToken.mint(recipients[i], amounts[i]);
            total += amounts[i];
        }

        emit WagesSettled(batchId, recipients.length, total);
    }
}
