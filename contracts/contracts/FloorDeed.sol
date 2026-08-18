// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title FloorDeed
 * @notice One NFT per owned floor. Each deed is a lit window in the skyline.
 *
 * @dev Token ids encode their location rather than being a counter:
 *
 *          tokenId = symbol | floorIndex
 *
 *      A bytes32 ticker keeps its characters in the *high* bytes and pads the
 *      rest with zeros, so the low 16 bits are free and the floor index drops
 *      straight into them. No shifting is involved: shifting the symbol left
 *      would push its leading characters out of the 256-bit word entirely and
 *      silently corrupt it.
 *
 *      Encoding position in the id makes "which floor is this?" answerable
 *      without a storage read, and makes double-minting a floor impossible by
 *      construction — the id itself is the uniqueness constraint, enforced by
 *      ERC721.
 */
contract FloorDeed is ERC721, Ownable {
    /// @notice Max floors addressable per tower (16 bits of the id).
    uint256 public constant MAX_FLOORS = 65535;

    mapping(address => bool) public isController;

    /// @notice symbol => how many floors have been minted there.
    mapping(bytes32 => uint256) public mintedFloors;

    event ControllerSet(address indexed controller, bool allowed);
    event FloorMinted(bytes32 indexed symbol, uint256 indexed floor, address indexed to);

    error NotController();
    error FloorOutOfRange(uint256 floor);
    error SymbolTooLong(bytes32 symbol);
    error ZeroAddress();

    modifier onlyController() {
        if (!isController[msg.sender]) revert NotController();
        _;
    }

    constructor() ERC721("Candlestick Floor", "FLOOR") Ownable(msg.sender) {}

    function setController(address controller, bool allowed) external onlyOwner {
        if (controller == address(0)) revert ZeroAddress();
        isController[controller] = allowed;
        emit ControllerSet(controller, allowed);
    }

    function tokenIdFor(bytes32 symbol, uint256 floor) public pure returns (uint256) {
        if (floor > MAX_FLOORS) revert FloorOutOfRange(floor);
        // The low 16 bits must be free for the floor index. Any ticker of 30
        // characters or fewer satisfies this; reject anything longer rather
        // than silently overwriting its tail.
        if (uint256(symbol) & 0xFFFF != 0) revert SymbolTooLong(symbol);
        return uint256(symbol) | floor;
    }

    function floorOf(uint256 tokenId) public pure returns (uint256) {
        return tokenId & 0xFFFF;
    }

    function symbolOf(uint256 tokenId) public pure returns (bytes32) {
        return bytes32(tokenId & ~uint256(0xFFFF));
    }

    /// @notice Mint one floor deed. Reverts if that exact floor already exists.
    function mintFloor(address to, bytes32 symbol, uint256 floor)
        external
        onlyController
        returns (uint256 tokenId)
    {
        tokenId = tokenIdFor(symbol, floor);
        _safeMint(to, tokenId);
        mintedFloors[symbol] += 1;
        emit FloorMinted(symbol, floor, to);
    }

    function exists(bytes32 symbol, uint256 floor) external view returns (bool) {
        return _ownerOf(tokenIdFor(symbol, floor)) != address(0);
    }
}
